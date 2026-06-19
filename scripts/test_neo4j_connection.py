import os
from neo4j import GraphDatabase

# 載入 .env.local 檔案中的環境變數
env_vars = {}
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.env.local"))

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
    print(f"讀取 .env.local 失敗 (路徑: {env_path}): {e}")

uri = env_vars.get("NEO4J_URI")
username = env_vars.get("NEO4J_USERNAME", "neo4j")
password = env_vars.get("NEO4J_PASSWORD")

print(f"正在嘗試連線至: {uri}")
print(f"使用者名稱: {username}")

try:
    with GraphDatabase.driver(uri, auth=(username, password)) as driver:
        # 驗證連線
        driver.verify_connectivity()
    print("\n[成功] 恭喜！已順利連線至 Neo4j AuraDB 雲端資料庫！")
except Exception as e:
    print(f"\n[失敗] 連線失敗。錯誤訊息如下:\n{e}")
