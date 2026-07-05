import { getPostgresPool } from '../lib/postgres';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

const targetJids = [
  'CLEV,114,壢小,1477,20260410,2',
  'CLEV,114,壢小,1762,20260410,2',
  'CPEV,115,竹北簡,106,20260430,2',
  'TCEV,114,中小,4977,20260430,1',
  'TCEV,114,中簡,1843,20260410,1',
  'NHEV,114,湖簡,1395,20260415,1',
  'SJEV,114,重簡,365,20260424,1',
  'TNDM,115,交易,146,20260421,1'
];

async function run() {
  console.log('🚀 開始為黃金測試集指定的 8 筆判決書 Chunks 補全向量...');
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE || undefined,
  });

  try {
    // 1. 查詢這 4 筆判決書的所有 Chunks
    const query = `
      SELECT id, text, judgment_id 
      FROM chunks 
      WHERE judgment_id = ANY($1) AND embedding IS NULL
    `;
    const res = await client.query(query, [targetJids]);
    const chunks = res.rows;
    console.log(`找到 ${chunks.length} 筆未向量化的黃金 Chunks。`);

    if (chunks.length === 0) {
      console.log('✅ 所有黃金 Chunks 已經完成了向量化！');
      return;
    }

    // 2. 逐一計算向量並更新
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[${i + 1}/${chunks.length}] 正在為 ${chunk.id} 計算向量...`);
      
      const embedResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk.text.replace(/\n/g, ' ').trim(),
      });
      const embedding = embedResponse.data[0].embedding;
      const vectorStr = `[${embedding.join(',')}]`;

      await client.query(
        'UPDATE chunks SET embedding = $1 WHERE id = $2',
        [vectorStr, chunk.id]
      );
    }
    
    console.log('🎉 黃金測試集 Chunks 向量補全成功！');
  } catch (e: any) {
    console.error('❌ 向量補全失敗:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
