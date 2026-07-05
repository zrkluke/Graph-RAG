import { Pool } from 'pg';

declare global {
  var postgresPool: Pool | undefined;
}

export function getPostgresPool(): Pool {
  if (!globalThis.postgresPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('缺少 DATABASE_URL 環境變數！');
    }
    
    console.log('🔌 [PostgreSQL] 初始化連線池...');
    globalThis.postgresPool = new Pool({
      connectionString,
      ssl: {
        // Supabase Free Tier 通常需要啟用 SSL 連接
        rejectUnauthorized: false,
      },
      max: 3, // 調低最大連線數，適應 Vercel Serverless 冷啟動時的 Supabase Free Tier 連線池上限限制
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return globalThis.postgresPool;
}

