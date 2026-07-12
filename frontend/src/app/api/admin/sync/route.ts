import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getPostgresPool } from '@/lib/postgres';
import { getNeo4jDriver } from '@/lib/neo4j';
import { import_single_file, getJsonFiles } from '@/scripts/import_judgments';

// 限制併發處理的輔助函數 (純 TS 實現，免除 p-limit 依賴)
async function runWithConcurrencyLimit(tasks: (() => Promise<void>)[], limit: number) {
  const activeTasks: Promise<void>[] = [];
  for (const task of tasks) {
    const p = task();
    activeTasks.push(p);
    p.then(() => {
      activeTasks.splice(activeTasks.indexOf(p), 1);
    });
    if (activeTasks.length >= limit) {
      await Promise.race(activeTasks);
    }
  }
  await Promise.all(activeTasks);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'sync'; // 'enqueue' | 'sync'
    const limit = parseInt(body.limit || '10', 10);
    const force = body.force === true;

    const pool = getPostgresPool();

    // 1. 處理：排入佇列（掃描本地檔案並加入 Queue）
    if (action === 'enqueue') {
      // 優先搜尋 special_cases 資料夾以進行快速測試與保活，避免掃描 10 萬筆全量資料造成超時
      let dataDir = path.resolve(process.cwd(), '../data/special_cases');
      if (!fs.existsSync(dataDir)) {
        dataDir = path.resolve(process.cwd(), 'data/special_cases');
      }
      if (!fs.existsSync(dataDir)) {
        dataDir = path.resolve(process.cwd(), 'frontend/data/special_cases');
      }
      if (!fs.existsSync(dataDir)) {
        dataDir = path.resolve(process.cwd(), '../data');
      }
      if (!fs.existsSync(dataDir)) {
        dataDir = path.resolve(process.cwd(), 'data');
      }

      if (!fs.existsSync(dataDir)) {
        return NextResponse.json(
          { error: '找不到資料夾 data/。請確認專案路徑配置！' },
          { status: 400 }
        );
      }

      console.log(`[Queue Enqueue] 正在掃描資料夾：${dataDir}`);
      const jsonFiles = getJsonFiles(dataDir);
      console.log(`[Queue Enqueue] 發現 ${jsonFiles.length} 筆判決書 JSON 檔案`);

      let enqueuedCount = 0;
      
      // 將任務檔案分批寫入（每批 2000 筆，避免超過 PostgreSQL 的 65535 參數上限與記憶體溢出）
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const chunkSize = 2000;
        for (let i = 0; i < jsonFiles.length; i += chunkSize) {
          const chunk = jsonFiles.slice(i, i + chunkSize);
          const values: any[] = [];
          const placeholders: string[] = [];
          let paramIndex = 1;

          for (const file of chunk) {
            try {
              const content = fs.readFileSync(file, 'utf8');
              const data = JSON.parse(content);
              const jid = data.JID;
              
              if (jid) {
                placeholders.push(`($${paramIndex}, $${paramIndex + 1}, 'pending')`);
                values.push(jid, file);
                paramIndex += 2;
              }
            } catch (err) {
              // 忽略損毀檔案
            }
          }

          if (values.length > 0) {
            const insertQuery = `
              INSERT INTO verdict_sync_jobs (jid, file_path, status)
              VALUES ${placeholders.join(',')}
              ON CONFLICT (jid) DO NOTHING;
            `;
            const res = await client.query(insertQuery, values);
            enqueuedCount += res.rowCount || 0;
          }
        }
        
        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }


      return NextResponse.json({
        success: true,
        message: `排入佇列完成！掃描了 ${jsonFiles.length} 筆檔案，新增 ${enqueuedCount} 筆新任務至佇列。`,
        totalScanned: jsonFiles.length,
        newEnqueued: enqueuedCount,
      });
    }

    // 2. 處理：執行同步（處理 pending 佇列）
    // 預設的環境變數排程保護，只有手動 (force) 或開啟排程才執行
    if (!force && process.env.ENABLE_AUTO_SYNC !== 'true') {
      return NextResponse.json({
        success: true,
        message: '跳過自動排程同步（未啟用排程：ENABLE_AUTO_SYNC !== true）',
        skipped: true,
      });
    }

    const neo4jDriver = getNeo4jDriver();

    // 2.1 鎖定並拉取 pending 任務
    const selectClient = await pool.connect();
    let jobs: { id: string; jid: string; file_path: string }[] = [];
    
    try {
      await selectClient.query('BEGIN');
      const selectQuery = `
        UPDATE verdict_sync_jobs
        SET status = 'processing', updated_at = NOW()
        WHERE id IN (
            SELECT id FROM verdict_sync_jobs 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT $1 
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, jid, file_path;
      `;
      const selectRes = await selectClient.query(selectQuery, [limit]);
      jobs = selectRes.rows;
      await selectClient.query('COMMIT');
    } catch (err) {
      await selectClient.query('ROLLBACK');
      throw err;
    } finally {
      selectClient.release();
    }

    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: '沒有待執行的 Pending 任務。',
        processed: 0,
      });
    }

    console.log(`[Queue Sync] 取得 ${jobs.length} 筆 Pending 任務開始處理...`);

    let successCount = 0;
    let failedCount = 0;

    // 2.2 併發控制處理任務 (concurrency = 2 避免 Neo4j AuraDB 鎖死)
    const tasks = jobs.map((job) => async () => {
      const session = neo4jDriver.session();
      try {
        if (!job.file_path || !fs.existsSync(job.file_path)) {
          throw new Error(`本地判決書檔案不存在於指定路徑: ${job.file_path}`);
        }

        // 執行雙寫匯入
        await import_single_file(job.file_path, session, pool);

        // 更新任務狀態為 completed
        const updateSuccessQuery = `
          UPDATE verdict_sync_jobs 
          SET status = 'completed', error_message = NULL, updated_at = NOW() 
          WHERE id = $1;
        `;
        await pool.query(updateSuccessQuery, [job.id]);
        successCount++;
        console.log(`[Queue Sync Success] 成功同步判決: ${job.jid}`);
      } catch (err: any) {
        failedCount++;
        const errMsg = err.message || err.toString();
        console.error(`[Queue Sync Failed] 同步判決失敗 ${job.jid}:`, errMsg);

        // 更新任務狀態為 failed，記錄錯誤訊息且 retry_count +1
        const updateFailedQuery = `
          UPDATE verdict_sync_jobs 
          SET status = 'failed', error_message = $2, retry_count = retry_count + 1, updated_at = NOW() 
          WHERE id = $1;
        `;
        await pool.query(updateFailedQuery, [job.id, errMsg]);
      } finally {
        await session.close();
      }
    });

    // 以併發數 2 執行寫入
    await runWithConcurrencyLimit(tasks, 2);

    return NextResponse.json({
      success: true,
      message: `同步批次處理完成！成功: ${successCount} 筆，失敗: ${failedCount} 筆。`,
      processed: jobs.length,
      successCount,
      failedCount,
    });

  } catch (error: any) {
    console.error('[API Sync POST Error]:', error);
    return NextResponse.json(
      { error: error.message || '執行資料同步出錯' },
      { status: 500 }
    );
  }
}
