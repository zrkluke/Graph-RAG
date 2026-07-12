import { NextResponse } from 'next/server';
import { getNeo4jDriver } from '@/lib/neo4j';
import { getPostgresPool } from '@/lib/postgres';

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

    // 2. 連線 Neo4j 並執行寫入操作以重置 72 小時計時器
    const driverInstance = getNeo4jDriver();
    const session = driverInstance.session();
    let lastSeen = null;

    try {
      const cypher = `
        MERGE (h:Heartbeat {id: 'keep-alive'})
        SET h.lastSeen = datetime()
        RETURN h.lastSeen AS lastSeen
      `;
      
      const res = await session.run(cypher);
      const record = res.records[0];
      lastSeen = record ? record.get('lastSeen').toString() : null;

      console.log(`[Cron Success] Neo4j 心跳寫入成功，目前時間: ${lastSeen}`);

    } finally {
      await session.close();
    }

    // 3. 連線 Postgres (Supabase) 並執行輕量查詢以重置其活躍計時器
    const pool = getPostgresPool();
    const pgRes = await pool.query('SELECT 1 AS alive;');
    const postgresAlive = pgRes.rows[0]?.alive;
    console.log(`[Cron Success] Postgres (Supabase) 心跳查詢成功，alive: ${postgresAlive}`);

    return NextResponse.json({
      success: true,
      message: '心跳更新成功，資料庫已成功重置活躍計時器！',
      neo4jLastSeen: lastSeen,
      postgresAlive: postgresAlive === 1,
    });

  } catch (error: any) {
    console.error('[Cron Error] Keep-Alive 執行失敗:', error);
    return NextResponse.json(
      { error: error.message || '內部心跳寫入錯誤' },
      { status: 500 }
    );
  }
}
