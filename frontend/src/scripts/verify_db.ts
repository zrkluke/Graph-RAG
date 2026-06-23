import neo4j from 'neo4j-driver';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

function toJSNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  if (val.low !== undefined) return val.low;
  return Number(val) || 0;
}

export async function verify_db() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  
  if (!uri || !password) {
    console.error("錯誤：缺少 Neo4j 連線環境變數！請確認 .env.local 檔案配置。");
    return;
  }

  console.log(`正在連線至 Neo4j 以驗證數據...`);
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

  try {
    await driver.verifyConnectivity();
    const session = driver.session();
    
    try {
      // 1. 查詢節點數量
      console.log("\n=== 節點數量 ===");
      const labels = ["Judgment", "Section", "Chunk", "Law", "Person"];
      for (const label of labels) {
        const result = await session.run(`MATCH (n:${label}) RETURN count(n) AS cnt`);
        const record = result.records[0];
        console.log(`  (${label}) 節點數: ${toJSNumber(record.get('cnt'))}`);
      }
          
      // 2. 查詢關係數量
      console.log("\n=== 關係類型與數量 ===");
      const relsResult = await session.run("MATCH ()-[r]->() RETURN type(r) AS rel_type, count(r) AS cnt ORDER BY cnt DESC");
      relsResult.records.forEach(record => {
        console.log(`  [-${record.get('rel_type')}-]-> 數量: ${toJSNumber(record.get('cnt'))}`);
      });
          
      // 3. 查詢判決書的案件種類分佈
      console.log("\n=== 判決書案科分佈 ===");
      const caseResult = await session.run("MATCH (j:Judgment) RETURN j.case_type AS case_type, count(j) AS cnt");
      caseResult.records.forEach(record => {
        const type = record.get('case_type') || '未分類';
        console.log(`  ${type}: ${toJSNumber(record.get('cnt'))} 筆`);
      });
          
      // 4. 索引驗證
      console.log("\n=== 索引狀態 ===");
      const indexesResult = await session.run("SHOW INDEXES YIELD name, type, state, labelsOrTypes, properties");
      let textIndexFound = false;
      let vectorIndexFound = false;

      indexesResult.records.forEach(record => {
        const name = record.get('name');
        if (name === 'judgment_text_index') {
          textIndexFound = true;
          console.log(`  [全文索引] 名稱: ${name}`);
          console.log(`    類型: ${record.get('type')}`);
          console.log(`    狀態: ${record.get('state')}`);
          console.log(`    套用標籤: ${record.get('labelsOrTypes')}`);
          console.log(`    套用屬性: ${record.get('properties')}`);
        } else if (name === 'chunk_embedding_index') {
          vectorIndexFound = true;
          console.log(`  [向量索引] 名稱: ${name}`);
          console.log(`    類型: ${record.get('type')}`);
          console.log(`    狀態: ${record.get('state')}`);
          console.log(`    套用標籤: ${record.get('labelsOrTypes')}`);
          console.log(`    套用屬性: ${record.get('properties')}`);
        }
      });
      
      if (!textIndexFound) {
        console.log("  警告：未找到 judgment_text_index 全文索引！");
      }
      if (!vectorIndexFound) {
        console.log("  警告：未找到 chunk_embedding_index 向量索引！");
      }

    } finally {
      await session.close();
    }
  } catch (e) {
    console.error(`驗證失敗: ${e}`);
  } finally {
    await driver.close();
    console.log("\nNeo4j 連線已關閉。");
  }
}

if (require.main === module) {
  verify_db().catch(err => {
    console.error('執行數據驗證出錯：', err);
  });
}
