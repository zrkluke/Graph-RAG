import { getPostgresPool } from '../lib/postgres';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

export async function get_unembedded_chunks(pool: any, limit?: number): Promise<{ id: string; text: string }[]> {
  const client = await pool.connect();
  try {
    let query = 'SELECT id, text FROM chunks WHERE embedding IS NULL';
    const params: any[] = [];
    if (limit) {
      query += ' LIMIT $1';
      params.push(limit);
    }
    
    console.log('正在自 PostgreSQL 讀取未向量化 Chunk...');
    const result = await client.query(query, params);
    return result.rows.map((r: any) => ({
      id: r.id as string,
      text: r.text as string
    }));
  } finally {
    client.release();
  }
}

export async function update_embeddings_batch(pool: any, batch_data: { id: string; embedding: number[] }[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = 'UPDATE chunks SET embedding = $1 WHERE id = $2';
    for (const item of batch_data) {
      // pgvector 在 node-postgres 中需要格式化為 "[0.1, 0.2, ...]" 字串寫入
      const vectorStr = `[${item.embedding.join(',')}]`;
      await client.query(query, [vectorStr, item.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function main(limit?: number, batchSize: number = 100) {
  const connectionString = process.env.DATABASE_URL;
  const openai_key = process.env.OPENAI_API_KEY;
  const openai_base = process.env.OPENAI_API_BASE;
  
  if (!connectionString) {
    console.log("[錯誤] 請檢查環境變數中的 DATABASE_URL 設定！");
    return;
  }
      
  if (!openai_key || openai_key.includes("your-openai-api-key")) {
    console.log("[錯誤] 請在環境變數中填入正確的 OPENAI_API_KEY！");
    return;
  }

  console.log("正在初始化 OpenAI 客戶端與 PostgreSQL 連線池...");
  const openai = new OpenAI({
    apiKey: openai_key,
    baseURL: openai_base || undefined
  });
  
  const pool = getPostgresPool();
  try {
    // 獲取尚未向量化的 Chunks
    const chunks = await get_unembedded_chunks(pool, limit);
    const total = chunks.length;
    console.log(`找到 ${total} 筆未向量化的 Chunk 記錄。`);
    
    if (total === 0) {
      console.log("所有 Chunk 記錄均已完成向量化。");
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
        
        await update_embeddings_batch(pool, batchData);
        console.log(`  [進度] 已成功更新第 ${i + batch.length} / ${total} 筆 Chunk 向量`);
      } catch (err: any) {
        console.error(`  [錯誤] 處理批次 ${i} 至 ${i + batch.length} 失敗:`, err.message);
      }
    }
    
    console.log("向量補全更新執行完畢！");
  } finally {
    await pool.end();
    console.log("PostgreSQL 連線池已關閉。");
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
