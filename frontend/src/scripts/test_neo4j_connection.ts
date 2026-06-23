import neo4j from 'neo4j-driver';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

async function main() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  console.log(`正在嘗試連線至: ${uri}`);
  console.log(`使用者名稱: ${username}`);

  if (!uri || !password) {
    console.error("\n[錯誤] 未設定 NEO4J_URI 或 NEO4J_PASSWORD 環境變數，請確認 .env.local 檔案存在與內容正確。");
    process.exit(1);
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    // 驗證連線
    await driver.verifyConnectivity();
    console.log("\n[成功] 恭喜！已順利連線至 Neo4j AuraDB 雲端資料庫！");
  } catch (e) {
    console.error(`\n[失敗] 連線失敗。錯誤訊息如下:\n${e}`);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

main().catch(err => {
  console.error("執行連線測試出錯：", err);
  process.exit(1);
});
