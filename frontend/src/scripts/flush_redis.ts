import { getRedisClient } from '../lib/redis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

async function run() {
  try {
    const redis = getRedisClient();
    console.log('🔄 正在連線並清空 Upstash Redis 快取資料...');
    const result = await redis.flushall();
    console.log(`⚡ Redis 快取清空成功！結果: ${result}`);
    process.exit(0);
  } catch (e: any) {
    console.error('❌ 清空 Redis 失敗:', e.message || e);
    process.exit(1);
  }
}

run();
