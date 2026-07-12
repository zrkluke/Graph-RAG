## Why

本專案使用免費版 Supabase Postgres 與 Neo4j AuraDB Free，為防範自動同步消耗過多免費資源額度，且解決 Vercel Serverless Function 的 10 秒執行超時限制，系統需要：
1. 一個高可靠性的增量 Ingestion 任務佇列，並維持「預設不啟用排程、由環境變數控制、可由後台手動觸發」的彈性。
2. 一個視覺化後台（Admin Dashboard）展示同步狀態，並能手動觸發同步、重試失敗任務與執行社群偵測（LPA）。
3. 優化 Neo4j 連線寫入事務，限制併發數以降低免費 AuraDB 的死結機率。

## What Changes

- 在 Supabase Postgres 中建立 `verdict_sync_jobs` 任務佇列資料表。
- 實作 Next.js 後台 API：`/api/admin/jobs`、`/api/admin/sync` 及 `/api/admin/community-detection`。
- 實作 Next.js 管理後台頁面 `/admin`。
- 重構 Ingestion 併發控制，將 Neo4j 寫入限制在安全 Concurrency 級別並優化 Deadlock 重試。

## Capabilities

### New Capabilities

- `admin-dashboard-and-sync-pipeline`: 實作任務佇列、管理後台 UI、防封鎖與防超時同步機制、以及 Neo4j 併發寫入防死結優化。

### Modified Capabilities

## Impact

- 影響檔案：
  - 新增：`frontend/src/app/admin/page.tsx`、`/api/admin/jobs/route.ts`、`/api/admin/sync/route.ts`、`/api/admin/community-detection/route.ts`、`frontend/src/scripts/init_jobs_table.sql`。
  - 修改：Ingestion 寫入相關腳本或呼叫模組。
- 外部系統：Supabase PostgreSQL（新增 Jobs 表與狀態讀寫）、Neo4j AuraDB（寫入併發優化與 LPA 社群偵測）。
