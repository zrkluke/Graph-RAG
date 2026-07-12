## Why

由於專案使用的 Supabase (PostgreSQL) 與 Neo4j AuraDB 皆為免費託管方案，若專案超過 7 天 (Supabase) 或 72 小時 (Neo4j) 無任何活動，資料庫服務將被自動暫停。這會導致使用者在使用搜尋系統時遭遇連線失敗。因此，系統需要有一套「自動保活 (Keep-alive)」機制，定時向這兩個資料庫發起輕量查詢，以確保服務永久在線。

## What Changes

- 修改現有的 `/api/cron/keep-alive` 路由 (Next.js Serverless Route Handler)，除了現有的 Neo4j 心跳寫入外，額外導入 Supabase (PostgreSQL) 的連線與 `SELECT 1;` 心跳查詢。
- 確認 Vercel Cron 排程設定，使其能正確觸發此 API 路由。

## Capabilities

### New Capabilities

- `database-keep-alive`: 提供自動化資料庫保活心跳服務，同時確保 Supabase 與 Neo4j 兩個託管資料庫不因閒置而被自動暫停。

### Modified Capabilities

## Impact

- 影響檔案：`frontend/src/app/api/cron/keep-alive/route.ts` (API 路由)
- 外部系統：Supabase PostgreSQL、Neo4j AuraDB (接受定時心跳查詢)
- 部署平台：Vercel Cron Jobs (依據 `vercel.json` 進行排程觸發)
