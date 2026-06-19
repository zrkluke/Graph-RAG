# -*- coding: utf-8 -*-
"""
法律判決書資料匯入 Neo4j 腳本

功能：
  1. 遍歷 data/202604/ 目錄下的 JSON 檔案。
  2. 解析檔案所在資料夾名稱以獲取法院、法院層級與案件種類。
  3. 清洗判決書全文，抽取引用法條與關係人（法官、原告、被告、代理人）。
  4. 連線 Neo4j 資料庫，建立 Unique Constraints 與 Full-Text Index。
  5. 批量匯入節點與關係。
"""
import sys
import os
import re
import json
import glob
import argparse
from pathlib import Path
from neo4j import GraphDatabase
from dotenv import load_dotenv

# 保證 scripts 目錄內模組可以正常引用
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from court_parser import parse_court_from_folder
from text_cleaner import clean_judgment_text
from statute_parser import extract_statutes
from judgment_splitter import split_judgment_into_sections


def extract_parties_and_judges(full_text: str):
    """
    從判決書全文中抽取原告、被告、代理人與法官。
    """
    lines = full_text.split('\n')
    
    # 1. 提取法官
    judges = []
    for line in lines:
        line_stripped = line.strip()
        # 尋找法官行，例如「法官 陳筠諼」或「審判長法官 陳筠諼」
        judge_match = re.search(r'(?:審判長法官|獨任法官|實習法官|法[ \t\u3000]*官)[ \t\u3000]*([^\r\n\s\u3000]+)', line_stripped)
        if judge_match:
            name = judge_match.group(1)
            # 過濾常見噪音字詞
            if name and not any(k in name for k in ["書記官", "正本", "以上", "處分", "判決"]):
                name = re.split(r'[（(]', name)[0].strip()
                if 2 <= len(name) <= 10:  # 台灣人名通常在 2 至 10 字間
                    judges.append(name)
    
    judges = list(dict.fromkeys(judges))

    # 2. 提取原告、被告、訴訟代理人 (在前 150 行當事人區塊中)
    plaintiffs = []
    defendants = []
    representatives = []
    
    end_idx = len(lines)
    for idx, line in enumerate(lines[:150]):
        if any(k in line for k in ["上列當事人間", "上開當事人間", "當事人間", "判決如下", "裁定如下", "主文", "事實及理由"]):
            end_idx = idx
            break
            
    current_role = None  # 'PLAINTIFF', 'DEFENDANT', 'REPRESENTATIVE'
    
    for line in lines[:end_idx]:
        line_raw = line
        line_stripped = line.strip()
        if not line_stripped:
            continue
            
        if line_stripped in ["共同", "共", "同"]:
            continue
            
        is_p = re.match(r'^[ \t\u3000]*(?:上列)?原[ \t\u3000]*告[ \t\u3000]+([^\r\n]+)', line_raw)
        is_d = re.match(r'^[ \t\u3000]*(?:上列)?被[ \t\u3000]*告[ \t\u3000]+([^\r\n]+)', line_raw)
        is_rep = re.match(r'^[ \t\u3000]*(?:訴訟|法定|指定|複|共同)?代理人[ \t\u3000]+([^\r\n]+)', line_raw) or \
                 re.match(r'^[ \t\u3000]*(?:選任|指定|共同)?辯護人[ \t\u3000]+([^\r\n]+)', line_raw)
                 
        if is_p:
            current_role = 'PLAINTIFF'
            name_part = is_p.group(1).strip()
        elif is_d:
            current_role = 'DEFENDANT'
            name_part = is_d.group(1).strip()
        elif is_rep:
            current_role = 'REPRESENTATIVE'
            name_part = is_rep.group(1).strip()
        else:
            # 支援排版縮排的共同原告或被告
            if current_role and (line_raw.startswith(' ') or line_raw.startswith('\t') or line_raw.startswith('\u3000')):
                name_part = line_stripped
            else:
                name_part = None
                
        if name_part:
            # 清洗名字，切除住址、身份證號等資訊
            name_clean = re.split(r'[ \t\u3000]+(?:住|設|送達代收人|身分證|統一編號)', name_part)[0]
            name_clean = re.split(r'[（(]', name_clean)[0].strip()
            
            if name_clean:
                if name_clean not in ["共同", "共", "同", "原告", "被告", "訴訟代理人", "法定代理人", "辯護人", "上列"]:
                    if current_role == 'PLAINTIFF':
                        plaintiffs.append(name_clean)
                    elif current_role == 'DEFENDANT':
                        defendants.append(name_clean)
                    elif current_role == 'REPRESENTATIVE':
                        representatives.append(name_clean)
                        
    plaintiffs = list(dict.fromkeys(plaintiffs))
    defendants = list(dict.fromkeys(defendants))
    representatives = list(dict.fromkeys(representatives))
    
    return {
        "judges": judges,
        "plaintiffs": plaintiffs,
        "defendants": defendants,
        "representatives": representatives
    }


def init_db(driver):
    """
    初始化 Neo4j 資料庫，建立 Unique Constraints 與 Full-Text Index。
    """
    with driver.session() as session:
        # 1. 建立 Unique Constraints
        print("建立 Unique Constraints...")
        session.run("CREATE CONSTRAINT judgment_id_unique IF NOT EXISTS FOR (j:Judgment) REQUIRE j.id IS UNIQUE")
        session.run("CREATE CONSTRAINT section_id_unique IF NOT EXISTS FOR (s:Section) REQUIRE s.id IS UNIQUE")
        session.run("CREATE CONSTRAINT law_name_unique IF NOT EXISTS FOR (l:Law) REQUIRE l.name IS UNIQUE")
        session.run("CREATE CONSTRAINT person_name_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE")
        
        # 2. 建立 Full-Text Index
        print("建立 Full-Text Index...")
        session.run("""
            CREATE FULLTEXT INDEX judgment_text_index IF NOT EXISTS 
            FOR (n:Judgment) 
            ON EACH [n.main_text, n.fact_reason]
        """)


def write_to_neo4j(tx, data):
    """
    Cypher 寫入交易函數
    """
    # 1. 寫入 Judgment 節點
    judgment_query = """
    MERGE (j:Judgment {id: $id})
    ON CREATE SET 
      j.case_type = $case_type,
      j.court = $court,
      j.court_level = $court_level,
      j.date = case when $date is not null then date($date) else null end,
      j.reason = $reason,
      j.main_text = $main_text,
      j.fact_reason = $fact_reason
    ON MATCH SET
      j.case_type = $case_type,
      j.court = $court,
      j.court_level = $court_level,
      j.date = case when $date is not null then date($date) else null end,
      j.reason = $reason,
      j.main_text = $main_text,
      j.fact_reason = $fact_reason
    """
    tx.run(judgment_query, **data["judgment"])
    
    # 1.5 批次寫入 Section 節點並與 Judgment 連接
    if data.get("sections"):
        section_query = """
        UNWIND $sections AS sec
        MERGE (s:Section {id: sec.id})
        ON CREATE SET 
          s.role = sec.role,
          s.type = sec.type,
          s.text = sec.text
        ON MATCH SET
          s.role = sec.role,
          s.type = sec.type,
          s.text = sec.text
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:HAS_SECTION {index: sec.index}]->(s)
        """
        tx.run(section_query, id=data["judgment"]["id"], sections=data["sections"])
        
    # 2. 批次寫入並連接 Law 節點
    if data["laws"]:
        law_query = """
        UNWIND $laws AS law_name
        MERGE (l:Law {name: law_name})
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:CITED]->(l)
        """
        tx.run(law_query, id=data["judgment"]["id"], laws=data["laws"])
        
    # 3. 批次寫入並連接 Person 節點 (原告)
    if data["parties"]["plaintiffs"]:
        p_query = """
        UNWIND $plaintiffs AS p_name
        MERGE (p:Person {name: p_name})
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:PLAINTIFF]->(p)
        """
        tx.run(p_query, id=data["judgment"]["id"], plaintiffs=data["parties"]["plaintiffs"])
        
    # 4. 批次寫入並連接 Person 節點 (被告)
    if data["parties"]["defendants"]:
        d_query = """
        UNWIND $defendants AS d_name
        MERGE (p:Person {name: d_name})
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:DEFENDANT]->(p)
        """
        tx.run(d_query, id=data["judgment"]["id"], defendants=data["parties"]["defendants"])
        
    # 5. 批次寫入並連接 Person 節點 (代理人)
    if data["parties"]["representatives"]:
        r_query = """
        UNWIND $representatives AS r_name
        MERGE (p:Person {name: r_name})
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:REPRESENTED_BY]->(p)
        """
        tx.run(r_query, id=data["judgment"]["id"], representatives=data["parties"]["representatives"])
        
    # 6. 批次寫入並連接 Person 節點 (法官)
    if data["parties"]["judges"]:
        j_query = """
        UNWIND $judges AS j_name
        MERGE (p:Person {name: j_name})
        MERGE (j:Judgment {id: $id})
        MERGE (j)-[:JUDGED_BY]->(p)
        """
        tx.run(j_query, id=data["judgment"]["id"], judges=data["parties"]["judges"])


def import_judgments(data_dir: str, limit: int = None):
    # 1. 載入環境變數與資料庫連線
    dotenv_path = Path(__file__).resolve().parents[1] / ".env.local"
    load_dotenv(dotenv_path)
    
    uri = os.getenv("NEO4J_URI")
    username = os.getenv("NEO4J_USERNAME", "neo4j")
    password = os.getenv("NEO4J_PASSWORD")
    database = os.getenv("NEO4J_DATABASE", "neo4j")
    
    if not uri or not password:
        print("[錯誤] 請確認 .env.local 檔案中有設定 NEO4J_URI 與 NEO4J_PASSWORD！")
        return
        
    print(f"開始連線 Neo4j AuraDB: {uri} (Database: {database})")
    
    try:
        driver = GraphDatabase.driver(uri, auth=(username, password))
        driver.verify_connectivity()
        print("Neo4j 連線成功。")
    except Exception as e:
        print(f"[錯誤] Neo4j 連線失敗: {e}")
        return
        
    try:
        # 初始化資料庫索引與約束
        init_db(driver)
        
        # 2. 尋找所有判決書 JSON 檔案
        json_pattern = os.path.join(data_dir, "**/*.json")
        json_files = glob.glob(json_pattern, recursive=True)
        # 過濾非判決書檔案
        json_files = [f for f in json_files if not os.path.basename(f).startswith(".")]
        
        total_files = len(json_files)
        print(f"找到 {total_files} 筆判決書檔案。")
        
        if limit:
            json_files = json_files[:limit]
            print(f"已啟用限制：僅處理前 {len(json_files)} 筆檔案。")
            
        success_count = 0
        error_count = 0
        
        for idx, file_path in enumerate(json_files, 1):
            file_path_obj = Path(file_path)
            parent_folder = file_path_obj.parent.name
            
            # 解析法院資訊與案件種類
            court_info = parse_court_from_folder(parent_folder)
            if not court_info:
                print(f"[{idx}/{len(json_files)}] 警告：無法解析資料夾名稱 '{parent_folder}'，略過。")
                error_count += 1
                continue
                
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                jid = data.get("JID")
                jdate = data.get("JDATE", "")
                jtitle = data.get("JTITLE", "")
                jfull = data.get("JFULL", "")
                
                if not jid or not jfull:
                    print(f"[{idx}/{len(json_files)}] 警告：檔案缺少 JID 或 JFULL，略過。")
                    error_count += 1
                    continue
                
                # 清洗與轉換
                clean_text = clean_judgment_text(jfull)
                
                # 抽取法條與關係人
                extracted_statutes = extract_statutes(clean_text)
                laws_list = []
                for law, art, sub, _ in extracted_statutes:
                    laws_list.append(f"{law}第{art}條{sub}")
                laws_list = list(dict.fromkeys(laws_list))
                
                parties = extract_parties_and_judges(jfull)
                
                # 格式化日期為 YYYY-MM-DD
                date_str = None
                if len(jdate) == 8:
                    date_str = f"{jdate[:4]}-{jdate[4:6]}-{jdate[6:8]}"
                
                # 分離「主文」與「事實及理由」用於 Schema 儲存
                # 我們用「事實及理由」或「理由」作為 split 的分隔點
                main_text = ""
                fact_reason = clean_text
                
                split_patterns = [r"事實及理由\r?\n", r"事實\r?\n", r"理　由\r?\n", r"理由\r?\n"]
                for p in split_patterns:
                    parts = re.split(p, clean_text, maxsplit=1)
                    if len(parts) == 2:
                        main_text = parts[0].strip()
                        fact_reason = parts[1].strip()
                        break
                
                if not main_text:
                    main_text = jtitle  # fallback
                
                # 進行 Section 段落切分
                sections_list = split_judgment_into_sections(court_info["case_type"], fact_reason)
                formatted_sections = []
                for sec in sections_list:
                    formatted_sections.append({
                        "id": f"{jid}_sec_{sec['index']}",
                        "index": sec["index"],
                        "role": sec["role"],
                        "type": sec["type"],
                        "text": sec["text"]
                    })

                import_data = {
                    "judgment": {
                        "id": jid,
                        "case_type": court_info["case_type"],
                        "court": court_info["unit_norm"],
                        "court_level": court_info["court_root_norm"],
                        "date": date_str,
                        "reason": jtitle,
                        "main_text": main_text,
                        "fact_reason": fact_reason
                    },
                    "sections": formatted_sections,
                    "laws": laws_list,
                    "parties": parties
                }
                
                # 寫入 Neo4j (執行一個 transaction)
                with driver.session() as session:
                    session.execute_write(write_to_neo4j, import_data)
                    
                success_count += 1
                if idx % 5 == 0 or idx == len(json_files):
                    print(f"[{idx}/{len(json_files)}] 成功匯入 JID: {jid}")
                    
            except Exception as ex:
                print(f"[{idx}/{len(json_files)}] [錯誤] 匯入檔案 '{file_path_obj.name}' 失敗: {ex}")
                error_count += 1
                
        print(f"\n[匯入完成] 成功：{success_count} 筆，失敗：{error_count} 筆。")
        
    finally:
        driver.close()
        print("Neo4j 連線已關閉。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="匯入司法院判決書至 Neo4j 資料庫")
    parser.add_argument("--dir", default="data/202604", help="判決書 JSON 檔案存放目錄 (預設: data/202604)")
    parser.add_argument("--limit", type=int, default=None, help="限制處理檔案筆數 (用於測試)")
    args = parser.parse_args()
    
    import_judgments(args.dir, args.limit)
