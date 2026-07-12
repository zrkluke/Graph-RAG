import { getPostgresPool } from '../lib/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

async function initJobsTable() {
  console.log('🚀 開始初始化 verdict_sync_jobs 資料表...');
  const pool = getPostgresPool();
  
  let client;
  try {
    client = await pool.connect();
  } catch (connError: any) {
    console.error('❌ [連線錯誤] 無法建立資料庫連線:', connError.message);
    await pool.end();
    return;
  }

  try {
    // 建立 verdict_sync_jobs 任務表
    console.log('📝 建立 verdict_sync_jobs 資料表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS verdict_sync_jobs (
        id BIGSERIAL PRIMARY KEY,
        jid VARCHAR(100) NOT NULL UNIQUE,
        file_path TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        retry_count INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 建立索引以優化查詢效能
    console.log('⚡ 建立任務狀態與建立時間之複合索引...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_created 
      ON verdict_sync_jobs(status, created_at);
    `);

    console.log('🎉 verdict_sync_jobs 資料表與索引初始化成功！');
  } catch (error: any) {
    console.error('❌ 初始化失敗:', error.message);
  } finally {
    client.release();
    await pool.end();
    console.log('🔌 PostgreSQL 連線關閉。');
  }
}

initJobsTable();
