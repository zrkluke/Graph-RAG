import { getPostgresPool } from '../lib/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

const keywords = [
  { kw: '橈骨', name: '手部骨折' },
  { kw: '左手', name: '手部骨折' },
  { kw: '頭部外傷', name: '頭部受傷' },
  { kw: '腦震盪', name: '頭部受傷' },
  { kw: '脛骨', name: '腳部骨折' },
  { kw: '骨折', name: '通用骨折' },
  { kw: '鎖骨', name: '鎖骨胸部' },
  { kw: '擦傷', name: '擦挫傷' }
];

async function run() {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    for (const item of keywords) {
      const res = await client.query(
        'SELECT id, reason, substring(fact_reason, 1, 150) as snippet FROM judgments WHERE fact_reason ILIKE $1 LIMIT 2',
        [`%${item.kw}%`]
      );
      console.log(`\n=== 【${item.name}】關鍵字: ${item.kw} ===`);
      res.rows.forEach((r: any) => {
        console.log(`- ID: ${r.id}`);
        console.log(`  Reason: ${r.reason}`);
        console.log(`  Snippet: ${r.snippet.replace(/[\r\n\s\t]/g, '').substring(0, 80)}...`);
      });
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
