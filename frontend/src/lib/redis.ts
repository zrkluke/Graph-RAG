import Redis from 'ioredis';

declare global {
  var redisClient: Redis | undefined;
}

export function getRedisClient(): Redis {
  if (!globalThis.redisClient) {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;

    const isLocal = host === 'localhost' || host === '127.0.0.1';

    // 建立連線實例，設定重試與連線超時
    globalThis.redisClient = new Redis({
      host,
      port,
      password,
      tls: isLocal ? undefined : {}, // 雲端 Redis (如 Upstash) 需啟用 TLS
      connectTimeout: 5000, // 5秒連線超時
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          console.warn('⚠️ [Redis] 已達到最大重試次數，將不再重試');
          return null; // 停止重試並拋出錯誤
        }
        const delay = Math.min(times * 500, 2000);
        console.log(`🔄 [Redis] 連線中斷，正在進行第 ${times} 次重試，延遲 ${delay}ms...`);
        return delay;
      },
    });

    globalThis.redisClient.on('error', (err) => {
      // 避免因為連線錯誤導致 Next.js Server 崩潰
      console.error('❌ [Redis 連線錯誤]:', err.message || err);
    });

    globalThis.redisClient.on('connect', () => {
      console.log('⚡ [Redis] 已成功連線至 Redis 伺服器');
    });
  }
  return globalThis.redisClient;
}
