import { NextResponse } from 'next/server';
import { getPostgresPool } from '@/lib/postgres';

export async function GET() {
  try {
    const pool = getPostgresPool();
    
    // 1. 查詢各狀態的任務統計
    const countQuery = `
      SELECT status, COUNT(*) as count 
      FROM verdict_sync_jobs 
      GROUP BY status;
    `;
    const countRes = await pool.query(countQuery);
    
    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    
    countRes.rows.forEach((row: any) => {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = parseInt(row.count, 10);
      }
    });

    // 2. 查詢前 10 筆失敗的任務
    const failedQuery = `
      SELECT id, jid, status, error_message, retry_count, updated_at 
      FROM verdict_sync_jobs 
      WHERE status = 'failed' 
      ORDER BY updated_at DESC 
      LIMIT 10;
    `;
    const failedRes = await pool.query(failedQuery);

    return NextResponse.json({
      success: true,
      stats,
      failedJobs: failedRes.rows,
    });
  } catch (error: any) {
    console.error('[API Jobs GET Error]:', error);
    return NextResponse.json(
      { error: error.message || '查詢任務資料失敗' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const pool = getPostgresPool();
    
    // 將所有狀態為 failed 的任務重設為 pending，重試次數設為 0
    const resetQuery = `
      UPDATE verdict_sync_jobs 
      SET status = 'pending', retry_count = 0, error_message = NULL, updated_at = NOW() 
      WHERE status = 'failed'
      RETURNING id;
    `;
    const resetRes = await pool.query(resetQuery);

    return NextResponse.json({
      success: true,
      message: `重設成功！已將 ${resetRes.rowCount || 0} 筆失敗任務移回佇列中。`,
      count: resetRes.rowCount || 0,
    });
  } catch (error: any) {
    console.error('[API Jobs POST Error]:', error);
    return NextResponse.json(
      { error: error.message || '重設失敗任務出錯' },
      { status: 500 }
    );
  }
}
