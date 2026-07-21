import { NextResponse } from 'next/server';
import { getNeo4jDriver } from '@/lib/neo4j';
import { getPostgresPool } from '@/lib/postgres';
import { getRedisClient } from '@/lib/redis';

export async function GET(request: Request) {
  try {
    // 1. 驗證 Vercel Cron 排程安全性金鑰
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // 僅在生產環境且有設定 CRON_SECRET 時進行強校驗，方便開發或本地手動測試
    if (process.env.NODE_ENV === 'production' && cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[Cron Warning] 未授權的排程呼叫嘗試');
        return new Response('Unauthorized', { status: 401 });
      }
    }

    let neo4jAlive = false;
    let postgresAlive = false;
    let redisAlive = false;
    let lastSeen = null;

    // 2. 連線 Neo4j 並執行寫入操作以重置 72 小時計時器
    try {
      const driverInstance = getNeo4jDriver();
      const session = driverInstance.session();
      try {
        const cypher = `
          MERGE (h:Heartbeat {id: 'keep-alive'})
          SET h.lastSeen = datetime()
          RETURN h.lastSeen AS lastSeen
        `;
        
        const res = await session.run(cypher);
        const record = res.records[0];
        lastSeen = record ? record.get('lastSeen').toString() : null;
        neo4jAlive = !!lastSeen;
        console.log(`[Cron Success] Neo4j 心跳寫入成功，目前時間: ${lastSeen}`);
      } finally {
        await session.close();
      }
    } catch (neo4jErr: any) {
      console.error('[Cron Warning] Neo4j 心跳失敗:', neo4jErr.message || neo4jErr);
    }

    // 3. 連線 Postgres (Supabase) 並執行實體表讀取以重置其活躍計時器
    try {
      const dbUrl = process.env.DATABASE_URL || '';
      const hostMatch = dbUrl.match(/@([^:/]+)/);
      const pgHost = hostMatch ? hostMatch[1] : 'unknown';
      console.log(`🔌 [PostgreSQL] 嘗試連線至主機: ${pgHost}`);

      const pool = getPostgresPool();
      // 升級為實體表查詢，防止 Supabase 將單純的 SELECT 1 視為無效活動
      const pgRes = await pool.query('SELECT id FROM judgments LIMIT 1;');
      postgresAlive = pgRes.rows.length >= 0;
      console.log(`[Cron Success] Postgres (Supabase) 實體表心跳查詢成功，rows: ${pgRes.rows.length}`);
    } catch (pgErr: any) {
      console.error('[Cron Warning] Postgres (Supabase) 心跳失敗:', pgErr.message || pgErr);
    }

    // 4. 連線 Upstash Redis 執行 PING 與 Heartbeat Key 寫入，產生實質流量以保活
    try {
      const redis = getRedisClient();
      const redisPong = await redis.ping();
      // 寫入一個帶 TTL 的 heartbeat key，確保有 Write Traffic 產生
      await redis.set('heartbeat:keep-alive', new Date().toISOString(), 'EX', 86400); // 1 天後自動過期
      redisAlive = redisPong === 'PONG';
      console.log(`[Cron Success] Upstash Redis 心跳寫入成功，pong: ${redisPong}`);
    } catch (redisErr: any) {
      console.error('[Cron Warning] Upstash Redis 心跳失敗:', redisErr.message || redisErr);
    }

    const allSuccessful = neo4jAlive && postgresAlive && redisAlive;

    return NextResponse.json({
      success: allSuccessful,
      message: allSuccessful 
        ? '心跳更新成功，各遠端資源已成功重置活躍計時器！'
        : '部分遠端資源心跳更新失敗，請檢查日誌。',
      neo4jLastSeen: lastSeen,
      neo4jAlive,
      postgresAlive,
      redisAlive,
    }, {
      status: allSuccessful ? 200 : 207
    });

  } catch (error: any) {
    console.error('[Cron Error] Keep-Alive 執行失敗:', error);
    return NextResponse.json(
      { error: error.message || '內部心跳寫入錯誤' },
      { status: 500 }
    );
  }
}
