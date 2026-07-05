import { getPostgresPool } from '../lib/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

async function initPostgres() {
  console.log('🚀 開始初始化 PostgreSQL 資料庫...');
  const pool = getPostgresPool();
  
  let client;
  try {
    client = await pool.connect();
  } catch (connError: any) {
    console.error('❌ [連線錯誤] 無法建立資料庫連線:', connError.message);
    console.error('請檢查 DATABASE_URL 密碼是否正確編碼，且防火牆是否允許存取 Supabase。');
    await pool.end();
    return;
  }

  try {
    // 1. 啟用 pgvector 與 pg_trgm 擴充
    console.log('📦 [1/6] 嘗試啟用 pgvector 與 pg_trgm 擴充...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

    // 2. 建立 judgments 主表
    console.log('📝 [2/6] 建立 judgments 資料表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS judgments (
        id VARCHAR(100) PRIMARY KEY,
        case_type VARCHAR(20) NOT NULL,
        court VARCHAR(100) NOT NULL,
        court_level VARCHAR(50) NOT NULL,
        date DATE,
        reason VARCHAR(255),
        main_text TEXT,
        fact_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. 建立 sections 段落表
    console.log('📝 [3/6] 建立 sections 資料表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id VARCHAR(150) PRIMARY KEY,
        judgment_id VARCHAR(100) REFERENCES judgments(id) ON DELETE CASCADE,
        index INT NOT NULL,
        role VARCHAR(50),
        type VARCHAR(50),
        text TEXT NOT NULL
      );
    `);

    // 4. 建立 chunks 切片表
    console.log('📝 [4/6] 建立 chunks 資料表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id VARCHAR(200) PRIMARY KEY,
        section_id VARCHAR(150) REFERENCES sections(id) ON DELETE CASCADE,
        judgment_id VARCHAR(100) REFERENCES judgments(id) ON DELETE CASCADE,
        index INT NOT NULL,
        text TEXT NOT NULL,
        embedding VECTOR(1536)
      );
    `);

    // 5. 建立 HNSW 向量索引
    console.log('⚡ [5/6] 建立 chunks HNSW 向量索引...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS chunks_hnsw_idx 
      ON chunks USING hnsw (embedding vector_cosine_ops);
    `);

    // 6. 建立全文檢索與三連字元 (Trigram) GIN 索引
    console.log('⚡ [6/6] 建立 judgments 全文檢索與 Trigram GIN 索引...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS judgments_text_gin_idx 
      ON judgments USING gin (to_tsvector('simple', main_text || ' ' || fact_reason));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS judgments_trgm_main_idx 
      ON judgments USING gin (main_text gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS judgments_trgm_fact_idx 
      ON judgments USING gin (fact_reason gin_trgm_ops);
    `);

    console.log('🎉 PostgreSQL 資料庫初始化成功！');
  } catch (error: any) {
    console.error('❌ 初始化失敗:', error.message);
  } finally {
    client.release();
    await pool.end();
    console.log('🔌 PostgreSQL 連線關閉。');
  }
}

initPostgres();
