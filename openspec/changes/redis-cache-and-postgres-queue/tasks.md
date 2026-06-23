# Tasks: GCP VM Redis 快取與 Supabase 佇列實作待辦清單 (redis-cache-and-postgres-queue)

## 1. 本地與雲端資料庫準備
- [ ] **任務 1.1**：在根目錄的 `docker-compose.yml` 中新增 Redis 服務（ alpine 版並設定密碼與 LRU 淘汰機制）。
- [ ] **任務 1.2**：在 GCP 免費 e2-micro VM 上使用 Docker 啟動單獨的 Redis 容器，並設定防火牆僅允許 Vercel 與本地連線存取 6379 埠口。
- [ ] **任務 1.3**：在 Supabase 控制台建立 `verdict_sync_jobs` 資料表與對應 status 索引。

## 2. 後端快取與前端快取提示實作 (Redis 優先)
- [ ] **任務 2.1**：在 `frontend` 安裝 `ioredis`（Redis 客戶端）與 `@types/ioredis`。
- [ ] **任務 2.2**：實作 `redis_client.ts` 連線快取模組（防連線數溢出）。
- [ ] **任務 2.3**：重構 `/api/search/route.ts` 搜尋 API，整合 Redis 快取讀寫，並回傳 `cacheHit` 及 `executionTimeMs`。
- [ ] **任務 2.4**：修改 `frontend/src/app/page.tsx`，在搜尋結果 Dashboard 區塊顯示「API 總耗時」以及「快取命中 (Redis Cache Hit)」的 Hint 提示。
- [ ] **任務 2.5**：在本機啟動 Redis 容器，進行搜尋 API 測試，驗證第二次搜尋（Cache Hit）下，API 總耗時小於 20ms，且前端能正確看見快取命中 Hint。

## 3. 增量導入與 Ingestion Worker 實作 (Supabase 隨後)
- [ ] **任務 3.1**：在 `frontend` 安裝 `@supabase/supabase-js`（Postgres 連線客戶端）。
- [ ] **任務 3.2**：實作 VM 專用的 Consumer 輪詢腳本 `src/scripts/ingestion_worker.ts`，利用 `FOR UPDATE SKIP LOCKED` 鎖定任務。
- [ ] **任務 3.3**：在 Worker 中整合寫入 Neo4j 的冪等性與 `p-limit` 速率控制（1 筆/秒）。
- [ ] **任務 3.4**：實作 Vercel Cron 定時 API，每日凌晨定時向 Supabase `verdict_sync_jobs` 插入新任務。
- [ ] **任務 3.5**：在 VM 上使用 `pm2` 啟動 Ingestion Worker，驗證其持續運作與重試可靠性。

## 4. 同步控制台開發 (Admin Sync Dashboard)
- [ ] **任務 4.1**：於 Next.js 前端實作管理員頁面 `/admin/sync`（需基本帳密認證）。
- [ ] **任務 4.2**：讀取 Supabase API 顯示即時同步狀態（總覽、成功、失敗、排隊中）。
- [ ] **任務 4.3**：列出失敗的 Job ID，顯示 `error_message`，並提供「手動一鍵重試」與「一鍵清理成功日誌」按鈕。

