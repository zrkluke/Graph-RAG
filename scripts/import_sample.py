# -*- coding: utf-8 -*-
"""
法律判決書隨機比例抽樣匯入 Neo4j 腳本 (import_sample.py)

功能：
  1. 遍歷 data/202604/ 目錄，依子資料夾名稱（民事、刑事、行政、其他）分類。
  2. 按照各案件大類比例進行隨機抽樣，抽出指定總數（預設 10,000 筆）。
  3. 使用 ThreadPoolExecutor 並行解析與匯入，加速將資料寫入雲端 Neo4j AuraDB。
"""
import sys
import os
import re
import json
import random
import argparse
import concurrent.futures
from threading import Lock
from pathlib import Path
from neo4j import GraphDatabase
from dotenv import load_dotenv

# 保證 scripts 目錄內模組可以正常引用
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from court_parser import parse_court_from_folder
from text_cleaner import clean_judgment_text
from statute_parser import extract_statutes
from judgment_splitter import split_judgment_into_sections
from import_judgments import extract_parties_and_judges, init_db, write_to_neo4j

# 全域統計與執行緒鎖
success_count = 0
error_count = 0
progress_count = 0
counter_lock = Lock()

def parse_and_prepare_data(file_path):
    """
    讀取並解析單一判決書 JSON，格式化為寫入 Neo4j 所需的字典。
    """
    file_path_obj = Path(file_path)
    parent_folder = file_path_obj.parent.name
    
    # 解析法院資訊與案件種類
    court_info = parse_court_from_folder(parent_folder)
    if not court_info:
        return None, f"無法解析資料夾名稱 '{parent_folder}'"
        
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    jid = data.get("JID")
    jdate = data.get("JDATE", "")
    jtitle = data.get("JTITLE", "")
    jfull = data.get("JFULL", "")
    
    if not jid or not jfull:
        return None, "檔案缺少 JID 或 JFULL"
        
    # 清洗與轉換
    clean_text = clean_judgment_text(jfull)
    
    # 抽取法條與關係人
    extracted_statutes = extract_statutes(clean_text)
    laws_list = list(dict.fromkeys(f"{law}第{art}條{sub}" for law, art, sub, _ in extracted_statutes))

    
    parties = extract_parties_and_judges(jfull)
    
    # 格式化日期為 YYYY-MM-DD
    date_str = None
    if len(jdate) == 8:
        date_str = f"{jdate[:4]}-{jdate[4:6]}-{jdate[6:8]}"
        
    # 分離「主文」與「事實及理由」
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
        main_text = jtitle
        
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
    
    return import_data, None

def import_single_file(file_path, driver, database_name, total_files):
    """
    Worker 函數：處理單一檔案並寫入 Neo4j
    """
    global success_count, error_count, progress_count
    
    file_name = os.path.basename(file_path)
    
    # 1. 解析與格式化資料
    try:
        import_data, err = parse_and_prepare_data(file_path)
        if err:
            with counter_lock:
                error_count += 1
                progress_count += 1
            print(f"[{progress_count}/{total_files}] 警告：解析 '{file_name}' 失敗: {err}")
            return
    except Exception as e:
        with counter_lock:
            error_count += 1
            progress_count += 1
        print(f"[{progress_count}/{total_files}] [錯誤] 讀取/解析 '{file_name}' 異常: {e}")
        return
        
    # 2. 寫入 Neo4j
    try:
        with driver.session() as session:
            session.execute_write(write_to_neo4j, import_data)

        
        with counter_lock:
            success_count += 1
            progress_count += 1
            if progress_count % 50 == 0 or progress_count == total_files:
                print(f"[{progress_count}/{total_files}] 成功匯入 {import_data['judgment']['id']} (已成功: {success_count} 筆)")
    except Exception as ex:
        with counter_lock:
            error_count += 1
            progress_count += 1
        print(f"[{progress_count}/{total_files}] [錯誤] 寫入 Neo4j '{file_name}' 失敗: {ex}")

def main():
    parser = argparse.ArgumentParser(description="按比例隨機抽樣判決書匯入 Neo4j 資料庫")
    parser.add_argument("--dir", default="data/202604", help="判決書 JSON 檔案存放目錄 (預設: data/202604)")
    parser.add_argument("--total", type=int, default=10000, help="抽樣總筆數 (預設: 10000)")
    parser.add_argument("--workers", type=int, default=8, help="並行寫入執行緒數 (預設: 8)")
    args = parser.parse_args()
    
    data_dir = args.dir
    total_target = args.total
    
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
        
    # 2. 遍歷並按類別歸檔檔案
    print(f"開始掃描目錄 '{data_dir}' ...")
    civil_files = []
    criminal_files = []
    admin_files = []
    other_files = []
    
    for file_path_obj in Path(data_dir).rglob("*.json"):
        if file_path_obj.name.startswith("."):
            continue
        file_path = str(file_path_obj)
        folder_name = file_path_obj.parent.name
        
        if "刑事" in folder_name:
            criminal_files.append(file_path)
        elif "民事" in folder_name or "家事" in folder_name:
            civil_files.append(file_path)
        elif "行政" in folder_name or "訴願" in folder_name:
            admin_files.append(file_path)
        else:
            other_files.append(file_path)
                    
    total_found = len(civil_files) + len(criminal_files) + len(admin_files) + len(other_files)
    print(f"掃描完畢。共找到 {total_found} 筆判決書檔案：")
    print(f" - 民事/家事: {len(civil_files)} 筆")
    print(f" - 刑事: {len(criminal_files)} 筆")
    print(f" - 行政/訴願: {len(admin_files)} 筆")
    print(f" - 其他: {len(other_files)} 筆")
    
    # 3. 按比例計算各案件抽樣數
    p_civil = 0.6038
    p_criminal = 0.3559
    p_admin = 0.0386
    
    target_civil = int(round(total_target * p_civil))
    target_criminal = int(round(total_target * p_criminal))
    target_admin = int(round(total_target * p_admin))
    target_other = total_target - (target_civil + target_criminal + target_admin)
    
    print(f"\n抽樣規劃總數: {total_target} 筆")
    print(f" - 民事目標: {target_civil} 筆 (實際可用: {len(civil_files)})")
    print(f" - 刑事目標: {target_criminal} 筆 (實際可用: {len(criminal_files)})")
    print(f" - 行政目標: {target_admin} 筆 (實際可用: {len(admin_files)})")
    print(f" - 其他目標: {target_other} 筆 (實際可用: {len(other_files)})")
    
    # 執行隨機抽樣
    random.seed(42)  # 固定隨機種子，確保抽樣具備可重複性
    sampled_civil = random.sample(civil_files, min(len(civil_files), target_civil))
    sampled_criminal = random.sample(criminal_files, min(len(criminal_files), target_criminal))
    sampled_admin = random.sample(admin_files, min(len(admin_files), target_admin))
    sampled_other = random.sample(other_files, min(len(other_files), target_other))
    
    all_sampled = sampled_civil + sampled_criminal + sampled_admin + sampled_other
    random.shuffle(all_sampled)
    
    actual_total = len(all_sampled)
    print(f"隨機抽樣完成，實際抽出總數: {actual_total} 筆。")
    
    # 4. 開始連線 Neo4j
    print(f"\n開始連線 Neo4j AuraDB: {uri} (Database: {database})")
    try:
        driver = GraphDatabase.driver(uri, auth=(username, password))
        driver.verify_connectivity()
        print("Neo4j 連線成功。")
    except Exception as e:
        print(f"[錯誤] Neo4j 連線失敗: {e}")
        return
        
    try:
        # 初始化索引與約束
        init_db(driver)
        
        # 5. 使用 ThreadPoolExecutor 並行寫入
        print(f"\n開始並行寫入，執行緒數 (Workers): {args.workers} ...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            # 提交所有任務
            futures = [
                executor.submit(import_single_file, file_path, driver, database, actual_total)
                for file_path in all_sampled
            ]
            # 等待所有任務完成
            concurrent.futures.wait(futures)
            
        print(f"\n[匯入完成] 成功：{success_count} 筆，失敗：{error_count} 筆。")
        
    finally:
        driver.close()
        print("Neo4j 連線已關閉。")

if __name__ == "__main__":
    main()
