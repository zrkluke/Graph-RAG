import neo4j from 'neo4j-driver';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

export async function init_vector_index(driver: any) {
  const session = driver.session();
  try {
    console.log("正在檢測並建立 Chunk 向量索引...");
    await session.run(`
      CREATE VECTOR INDEX chunk_embedding_index IF NOT EXISTS
      FOR (c:Chunk) ON (c.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 1536,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    console.log("向量索引建立指令已送出。");
  } finally {
    await session.close();
  }
}

export async function get_unembedded_chunks(driver: any, limit?: number): Promise<{ id: string; text: string }[]> {
  const session = driver.session();
  try {
    let query = `
      MATCH (c:Chunk)
      WHERE c.embedding IS NULL
      RETURN c.id AS id, c.text AS text
    `;
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    console.log("正在自 Neo4j 讀取未向量化 Chunk...");
    const result = await session.run(query);
    return result.records.map((record: any) => ({
      id: record.get('id') as string,
      text: record.get('text') as string
    }));
  } finally {
    await session.close();
  }
}

export async function update_embeddings_batch(driver: any, batch_data: { id: string; embedding: number[] }[]) {
  const session = driver.session();
  try {
    const query = `
      UNWIND $batch AS item
      MATCH (c:Chunk {id: item.id})
      SET c.embedding = item.embedding
    `;
    await session.run(query, { batch: batch_data });
  } finally {
    await session.close();
  }
}

export async function main(limit?: number, batchSize: number = 100) {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  
  const openai_key = process.env.OPENAI_API_KEY;
  const openai_base = process.env.OPENAI_API_BASE;
  
  if (!uri || !password) {
    console.log("[錯誤] 請檢查環境變數中的 NEO4J_URI 與 NEO4J_PASSWORD 設定！");
    return;
  }
      
  if (!openai_key || openai_key.includes("your-openai-api-key")) {
    console.log("[錯誤] 請在環境變數中填入正確的 OPENAI_API_KEY！");
    return;
  }

  console.log("正在建立連線驅動...");
  const openai = new OpenAI({
    apiKey: openai_key,
    baseURL: openai_base || undefined
  });
  
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    await driver.verifyConnectivity();
    
    // 初始化向量索引
    await init_vector_index(driver);
    
    // 獲取尚未向量化的 Chunks
    const chunks = await get_unembedded_chunks(driver, limit);
    const total = chunks.length;
    console.log(`找到 ${total} 筆未向量化的 Chunk 節點。`);
    
    if (total === 0) {
      console.log("所有 Chunk 節點均已完成向量化。");
      return;
    }

    console.log(`開始進行向量化處理，批次大小: ${batchSize}...`);
    
    for (let i = 0; i < total; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.text.replace(/\n/g, ' ').trim());
      
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: texts
        });
        
        const batchData = batch.map((chunk, idx) => ({
          id: chunk.id,
          embedding: response.data[idx].embedding
        }));
        
        await update_embeddings_batch(driver, batchData);
        console.log(`  [進度] 已成功寫入第 ${i + batch.length} / ${total} 筆 Chunk 向量`);
      } catch (err) {
        console.error(`  [錯誤] 處理批次 ${i} 至 ${i + batch.length} 失敗:`, err);
      }
    }
    
    console.log("向量補全更新執行完畢！");
  } finally {
    await driver.close();
    console.log("Neo4j 連線已關閉。");
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let limit: number | undefined;
  let batchSize = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1]);
      i++;
    }
  }

  main(limit, batchSize).catch(err => {
    console.error('執行向量更新出錯：', err);
  });
}
