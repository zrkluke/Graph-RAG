# -*- coding: utf-8 -*-
"""
法律判決書混合檢索搜尋演算法 (search_pipeline.py)

功能：
  1. 調用 OpenAI Embedding API (text-embedding-3-small) 將查詢情境向量化。
  2. 使用 Neo4j 向量搜尋匹配最相近的 Section，並關聯至 Judgment。
  3. 沿圖譜提取去重後的法官、原告、被告與引用法規，按相似度得分排序回傳。
  4. 支援命令行 (CLI) 呼叫進行快速搜尋測試。
"""
import os
import sys
import argparse
from pathlib import Path
from neo4j import GraphDatabase
from dotenv import load_dotenv
from openai import OpenAI

# 保證 scripts 目錄內模組可以正常引用
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 解決 Windows 終端機 (CP950) 輸出編碼問題
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# 載入環境變數
dotenv_path = Path(__file__).resolve().parents[1] / ".env.local"
load_dotenv(dotenv_path)

def get_query_embedding(client, text, model="text-embedding-3-small"):
    """
    將查詢字串向量化
    """
    text = text.replace("\n", " ").strip()
    if not text:
        raise ValueError("查詢字串不能為空！")
    response = client.embeddings.create(input=[text], model=model)
    return response.data[0].embedding

def search_similar_judgments(query_text, court_level=None, case_type=None, limit=5):
    """
    執行混合圖譜與向量搜尋
    """
    # 1. 取得資料庫與 OpenAI 配置
    uri = os.getenv("NEO4J_URI")
    username = os.getenv("NEO4J_USERNAME", "neo4j")
    password = os.getenv("NEO4J_PASSWORD")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    openai_base = os.getenv("OPENAI_API_BASE")
    
    if not uri or not password or not openai_key:
        print("[錯誤] 請檢查 .env.local 檔案中的連線與 API 金鑰設定！")
        return []
        
    # 2. 向量化查詢字串
    client = OpenAI(api_key=openai_key, base_url=openai_base)
    try:
        query_vector = get_query_embedding(client, query_text)
    except Exception as e:
        print(f"[錯誤] OpenAI 向量化失敗: {e}")
        return []
        
    # 3. 建立 Neo4j 連線並查詢
    driver = GraphDatabase.driver(uri, auth=(username, password))
    try:
        with driver.session() as session:
            # 混合檢索 Cypher 查詢 (只回傳結構與過濾排序結果，無 LLM 文本生成)
            cypher_query = """
            // 1. 向量搜尋最相近的 Chunk，設定較大的初篩空間 (如 100 筆)
            CALL db.index.vector.queryNodes('chunk_embedding_index', 100, $queryVector)
            YIELD node AS chunk, score
            
            // 2. 透過關係向上還原至 Section 與 Judgment 判決書
            MATCH (s:Section)-[:HAS_CHUNK]->(chunk)
            MATCH (j:Judgment)-[:HAS_SECTION]->(s)
            
            // 3. 套用法院層級與案件大類篩選
            WHERE ($court_level IS NULL OR j.court_level = $court_level)
              AND ($case_type IS NULL OR j.case_type = $case_type)
              
            // 4. 提取去重後的法官、原告、被告與引用法條
            OPTIONAL MATCH (j)-[:JUDGED_BY]->(judge:Person)
            OPTIONAL MATCH (j)-[:DEFENDANT]->(defendant:Person)
            OPTIONAL MATCH (j)-[:PLAINTIFF]->(plaintiff:Person)
            OPTIONAL MATCH (j)-[:CITED]->(law:Law)
            
            // 5. 聚合數據，取該判決書下 Chunk 匹配的最高得分作為 Judgment 的相似度分數
            RETURN 
              j.id AS id,
              j.court AS court,
              j.court_level AS court_level,
              j.case_type AS case_type,
              j.reason AS reason,
              j.main_text AS main_text,
              j.fact_reason AS fact_reason,
              max(score) AS max_section_score,
              collect(distinct judge.name) AS judges,
              collect(distinct defendant.name) AS defendants,
              collect(distinct plaintiff.name) AS plaintiffs,
              collect(distinct law.name) AS cited_laws
            ORDER BY max_section_score DESC
            LIMIT $limit
            """
            
            result = session.run(
                cypher_query,
                queryVector=query_vector,
                court_level=court_level if court_level else None,
                case_type=case_type if case_type else None,
                limit=limit
            )
            
            return [dict(record) for record in result]
            
    except Exception as e:
        print(f"[錯誤] Neo4j 混合檢索執行失敗: {e}")
        return []
    finally:
        driver.close()

def main():
    parser = argparse.ArgumentParser(description="法律判決書 Graph RAG 混合搜尋 CLI 測試工具")
    parser.add_argument("--query", required=True, help="輸入要搜尋的自然語言情境描述")
    parser.add_argument("--court", default=None, choices=["地方法院", "高等法院", "最高法院"], help="篩選法院層級")
    parser.add_argument("--type", default=None, choices=["民事", "刑事", "行政"], help="篩選案件大類")
    parser.add_argument("--limit", type=int, default=3, help="返回結果筆數 (預設: 3)")
    args = parser.parse_args()
    
    print(f"正在搜尋情境: '{args.query}' ...")
    if args.court:
        print(f" - 篩選法院層級: {args.court}")
    if args.type:
        print(f" - 篩選案件種類: {args.type}")
        
    results = search_similar_judgments(
        query_text=args.query,
        court_level=args.court,
        case_type=args.type,
        limit=args.limit
    )
    
    print(f"\n檢索完成。共找到 {len(results)} 筆相似判決書：\n")
    
    for idx, r in enumerate(results, 1):
        print(f"【結果 {idx}】相似度得分: {r['max_section_score']:.4f}")
        print(f" - 判決字號: {r['id']}")
        print(f" - 法院/案由: {r['court']} | {r['reason']}")
        print(f" - 案件種類/層級: {r['case_type']} | {r['court_level']}")
        print(f" - 裁判法官: {', '.join(r['judges']) if r['judges'] else '無'}")
        print(f" - 被告人: {', '.join(r['defendants']) if r['defendants'] else '無'}")
        print(f" - 引用法規: {', '.join(r['cited_laws']) if r['cited_laws'] else '無'}")
        print(f" - 判決主文:\n   {r['main_text'][:150]}...")
        print("-" * 80)

if __name__ == "__main__":
    main()
