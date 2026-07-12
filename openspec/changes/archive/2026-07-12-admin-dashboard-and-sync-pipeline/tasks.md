## 1. 資料表與基礎建置

- [x] 1.1 撰寫並執行 `init_jobs_table.sql` 腳本以在 Supabase Postgres 建立 `verdict_sync_jobs` 表。

## 2. 後台管理 API 實作

- [x] 2.1 實作 `/api/admin/jobs` 路由（GET：取得狀態統計與失敗前 10 筆；POST：重設失敗任務）。
- [x] 2.2 實作 `/api/admin/sync` 路由（POST：支援手動觸發拉取同步，引入 `p-limit` 限制寫入併發 = 2，由 `ENABLE_AUTO_SYNC` 環境變數開關自動執行）。
- [x] 2.3 實作 `/api/admin/community-detection` 路由（POST：手動呼叫 `run_community_detection()`）。

## 3. 管理後台前端 UI 實作

- [x] 3.1 實作 `/admin` 頁面（使用 App Router 建立 `src/app/admin/page.tsx`）。
- [x] 3.2 於頁面中實作狀態統計卡片、同步操作面板（開始同步、重試失敗、社群偵測按鈕）及最近錯誤歷史列表。
