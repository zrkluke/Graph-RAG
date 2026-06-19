# -*- coding: utf-8 -*-
"""
Section 段落向量補全與索引建立腳本 (update_embeddings.py)

功能：
  1. 連線 Neo4j AuraDB 建立向量索引 (section_embedding_index)。
  2. 掃描資料庫中所有 embedding 為空的 Section 節點。
  3. 批次打包 Section 文字 (每批 100 筆) 調用 OpenAI Embedding API (text-embedding-3-small)。
  4. 使用 UNWIND 批次將向量寫回 Neo4j，以極速完成向量化並避免死結。
"""
import os
import sys
import time
import argparse
from pathlib import Path
from neo4j import GraphDatabase
from dotenv import load_dotenv
from openai import OpenAI

# 保證 scripts 目錄內模組可以正常引用
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 載入環境變數
dotenv_path = Path(__file__).resolve().parents[1] / ".env.local"
load_dotenv(dotenv_path)

def init_vector_index(driver):
    """
    初始化 Neo4j 向量索引
    """
    with driver.session() as session:
        print("正在檢測並建立 Section 向量索引...")
        session.run("""
            CREATE VECTOR INDEX section_embedding_index IF NOT EXISTS
            FOR (s:Section) ON (s.embedding)
            OPTIONS {indexConfig: {
              `vector.dimensions`: 1536,
              `vector.similarity_function`: 'cosine'
            }}
        """)

        # 等待索引上線 (可選，通常為非同步建立，此處僅印出狀態)
        time.sleep(2)
        print("向量索引建立指令已送出。")

def get_unembedded_sections(driver, limit=None):
    """
    獲取資料庫中尚未有 embedding 的 Section 節點
    """
    with driver.session() as session:
        query = """
        MATCH (s:Section)
        WHERE s.embedding IS NULL
        RETURN s.id AS id, s.text AS text
        """
        if limit:
            query += f" LIMIT {limit}"
        
        print("正在自 Neo4j 讀取未向量化 Section...")
        result = session.run(query)
        return [dict(record) for record in result]

def update_embeddings_batch(driver, batch_data):
    """
    以 UNWIND 批次將向量更新回 Neo4j
    """
    with driver.session() as session:
        query = """
        UNWIND $batch AS item
        MATCH (s:Section {id: item.id})
        SET s.embedding = item.embedding
        """
        session.run(query, batch=batch_data)

def main():
    parser = argparse.ArgumentParser(description="為 Neo4j 中的 Section 段落補全語意向量")
    parser.add_argument("--limit", type=int, default=None, help="限制處理的 Section 筆數 (用於測試)")
    parser.add_argument("--batch-size", type=int, default=100, help="每批發送給 OpenAI 的段落數量 (預設: 100)")
    args = parser.parse_args()
    
    # 1. 取得資料庫與 OpenAI 配置
    uri = os.getenv("NEO4J_URI")
    username = os.getenv("NEO4J_USERNAME", "neo4j")
    password = os.getenv("NEO4J_PASSWORD")
    
    openai_key = os.getenv("OPENAI_API_KEY")
    openai_base = os.getenv("OPENAI_API_BASE") # 支援第三方代理端點
    
    if not uri or not password:
        print("[錯誤] 請檢查 .env.local 檔案中的 NEO4J_URI 與 NEO4J_PASSWORD 設定！")
        return
        
    if not openai_key or "your-openai-api-key" in openai_key:
        print("[錯誤] 請在 .env.local 檔案中填入正確的 OPENAI_API_KEY！")
        return
        
    # 2. 初始化 OpenAI 與 Neo4j 連線
    print("正在建立連線驅動...")
    client = OpenAI(api_key=openai_key, base_url=openai_base)
    driver = GraphDatabase.driver(uri, auth=(username, password))
    
    try:
        driver.verify_connectivity()
        # 3. 初始化向量索引
        init_vector_index(driver)
        
        # 4. 讀取待處理 Section
        sections = get_unembedded_sections(driver, args.limit)
        total_sections = len(sections)
        
        if total_sections == 0:
            print("所有 Section 皆已完成向量化，無須更新！")
            return
            
        print(f"找到 {total_sections} 筆待向量化段落。開始處理（每批 {args.batch_size} 筆）...")
        
        success_count = 0
        batch_size = args.batch_size
        
        # 5. 批次處理
        for i in range(0, total_sections, batch_size):
            chunk = sections[i : i + batch_size]
            
            # 清理文字：移除不必要的空行，並限制單一 Section 最大字數以防超出 OpenAI 8,192 token 上限
            texts = [s["text"].replace("\n", " ").strip() for s in chunk]
            texts = [t[:5000] if t else "Empty section" for t in texts]
            
            response = None
            retries = 5
            for attempt in range(retries):
                try:
                    # 調用 OpenAI Batch Embedding API
                    response = client.embeddings.create(
                        input=texts,
                        model="text-embedding-3-small"
                    )
                    break  # 成功取得向量，跳出重試
                except Exception as api_err:
                    err_str = str(api_err).lower()
                    if ("rate_limit" in err_str or "429" in err_str) and attempt < retries - 1:
                        sleep_time = 3 * (attempt + 1)
                        print(f"[{success_count + len(chunk)}/{total_sections}] 觸發頻率限制，將於 {sleep_time} 秒後重試...")
                        time.sleep(sleep_time)
                    else:
                        raise api_err  # 其他錯誤（如 API key 失效）或超過重試上限，直接向上拋出
            
            if not response:
                print(f"[錯誤] 處理批次 {i} 至 {i + len(chunk)} 失敗：無法取得 OpenAI 向量回應")
                continue
                
            try:
                # 組裝寫回資料
                batch_update = []
                for idx, item in enumerate(chunk):
                    batch_update.append({
                        "id": item["id"],
                        "embedding": response.data[idx].embedding
                    })
                
                # 批次更新回 Neo4j
                update_embeddings_batch(driver, batch_update)
                
                success_count += len(chunk)
                print(f"[{success_count}/{total_sections}] 成功生成並寫入 {len(chunk)} 筆 Section 向量")
                
                # 每個批次處理完畢後微小休眠，降低 TPM 頻率壓力
                time.sleep(0.3)
                
            except Exception as ex:
                print(f"[錯誤] 更新批次 {i} 至 {i + len(chunk)} 回 Neo4j 失敗: {ex}")

                
        print(f"\n[向量更新完成] 成功更新 {success_count} 筆 Section 向量。")
        
    finally:
        driver.close()
        print("Neo4j 連線已關閉。")

if __name__ == "__main__":
    main()
