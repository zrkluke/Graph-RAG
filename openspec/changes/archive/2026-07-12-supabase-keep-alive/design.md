## Context

專案目前部署在 Vercel，並透過 `vercel.json` 中的 Vercel Cron Jobs 設定，每 2 天定期對 `/api/cron/keep-alive` 發送 GET 請求。
原本的 API 路由僅對 Neo4j AuraDB 寫入心跳節點，卻忽略了 Supabase (Postgres) 資料庫，使得 Supabase 判定專案處於閒置狀態，進而發出暫停預警信。

## Goals / Non-Goals

**Goals:**
- 擴充 `/api/cron/keep-alive` 路由，導入對 Supabase (PostgreSQL) 的心跳查詢。
- 直接引用專案內現有的 `frontend/src/lib/postgres.ts` 中的 `getPostgresPool()` 以維持連線生命週期與最大連線數限制。
- 實現同時對 Neo4j 與 Supabase 兩個資料庫的保活。

**Non-Goals:**
- 不修改 `vercel.json` 的 Cron 排程設定，因為 2 天一次的頻率已足夠保活兩大資料庫。
- 不修改搜尋或圖譜展開等業務 API。

## Decisions

- **使用封裝好的 `getPostgresPool()`**:
  - 專案中已針對 Serverless 環境調整好 `Pool` 的連線上限（`max: 3`）與超時機制。我們在 API 路由中直接引用它，以維持環境的一致性並避免連線溢出。
- **採用輕量化 SQL 查詢**:
  - 使用 `SELECT 1 AS alive;` 作為 Postgres 心跳。此查詢不需要進行硬碟 I/O 或複雜計算，速度快且資源消耗幾乎為零。

## Risks / Trade-offs

- **[Risk] 連線未回收導致資料庫連線池溢出**
  - **緩解措施**: `getPostgresPool` 內部使用 `globalThis` 對連線池對象進行全域快取，確保在 Next.js Serverless 的冷啟動與熱啟動中重複使用同一個 Pool，而不需在每次請求後關閉 Pool。
- **[Risk] Supabase 連線因網路震盪造成 Cron 執行超時**
  - **緩解措施**: 連線池已設定 `connectionTimeoutMillis: 5000` (5 秒)，即使資料庫無法連線也會在 5 秒內快速失敗並返回 500，不會拖垮 Serverless Function 的超時上限（10 秒）。
