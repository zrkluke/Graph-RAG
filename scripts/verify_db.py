# -*- coding: utf-8 -*-
"""
驗證 Neo4j 資料庫內已寫入的節點與關係數量
"""
import os
import sys
from neo4j import GraphDatabase

# 載入 .env.local 檔案中的環境變數
env_vars = {}
env_path = "c:/PythonSideProjects/Neo4j-GraphRAG/.env.local"
try:
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip()
except Exception as e:
    print(f"讀取 .env.local 失敗: {e}")

uri = env_vars.get("NEO4J_URI")
username = env_vars.get("NEO4J_USERNAME", "neo4j")
password = env_vars.get("NEO4J_PASSWORD")

if not uri or not password:
    print("缺少資料庫連線資訊！")
    sys.exit(1)

print(f"正在連線至 Neo4j 以驗證數據...")

try:
    with GraphDatabase.driver(uri, auth=(username, password)) as driver:
        with driver.session() as session:
            # 1. 查詢節點數量
            print("\n=== 節點數量 ===")
            for label in ["Judgment", "Law", "Person"]:
                result = session.run(f"MATCH (n:{label}) RETURN count(n) AS cnt")
                record = result.single()
                print(f"  ({label}) 節點數: {record['cnt']}")
                
            # 2. 查詢關係數量
            print("\n=== 關係類型與數量 ===")
            result = session.run("MATCH ()-[r]->() RETURN type(r) AS rel_type, count(r) AS cnt ORDER BY cnt DESC")
            for record in result:
                print(f"  [-{record['rel_type']}-]-> 數量: {record['cnt']}")
                
            # 3. 查詢判決書的案件種類分佈
            print("\n=== 判決書案科分佈 ===")
            result = session.run("MATCH (j:Judgment) RETURN j.case_type AS case_type, count(j) AS cnt")
            for record in result:
                print(f"  {record['case_type']}: {record['cnt']} 筆")
                
            # 4. 全文檢索索引驗證
            print("\n=== 全文檢索索引狀態 ===")
            result = session.run("SHOW INDEXES YIELD name, type, state, labelsOrTypes, properties")
            ft_found = False
            for record in result:
                if record['name'] == 'judgment_text_index':
                    ft_found = True
                    print(f"  索引名稱: {record['name']}")
                    print(f"  類型: {record['type']}")
                    print(f"  狀態: {record['state']}")
                    print(f"  套用標籤: {record['labelsOrTypes']}")
                    print(f"  套用屬性: {record['properties']}")
            if not ft_found:
                print("  警告：未找到 judgment_text_index 全文索引！")

except Exception as e:
    print(f"驗證失敗: {e}")
