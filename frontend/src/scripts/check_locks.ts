import { getPostgresPool } from '../lib/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

async function checkLocks() {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    console.log('🔍 [DB Admin] 正在查詢 PostgreSQL 活動連線與鎖定狀態...');
    
    const res = await client.query(`
      SELECT pid, query, state, age(clock_timestamp(), query_start) AS duration, wait_event_type, wait_event
      FROM pg_stat_activity 
      WHERE state IS NOT NULL AND query NOT LIKE '%pg_stat_activity%'
      ORDER BY duration DESC;
    `);

    console.log(`\n發現 ${res.rows.length} 個活動連線：`);
    res.rows.forEach((row: any) => {
      console.log(`- PID: ${row.pid} | State: ${row.state} | Duration: ${row.duration} | Wait Event: ${row.wait_event_type}:${row.wait_event}`);
      console.log(`  Query: ${row.query.substring(0, 150)}...\n`);
    });

    // 檢查是否有長時間處於 idle in transaction 的連線或卡死的匯入查詢
    const zombieTransactions = res.rows.filter((row: any) => 
      row.state === 'idle in transaction' || 
      (row.state === 'active' && row.query && row.query.includes('INSERT INTO verdict_sync_jobs'))
    );

    if (zombieTransactions.length > 0) {
      console.log(`⚠️ 發現 ${zombieTransactions.length} 個可能卡住的連線，正在嘗試終止...`);
      for (const conn of zombieTransactions) {
        console.log(`💀 終止 PID: ${conn.pid}`);
        await client.query('SELECT pg_terminate_backend($1);', [conn.pid]);
      }
      console.log('✅ 卡住的連線已成功清除！');
    } else {
      console.log('👍 沒有發現卡住的資料庫連線。');
    }

  } catch (err: any) {
    console.error('查詢出錯:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkLocks();
