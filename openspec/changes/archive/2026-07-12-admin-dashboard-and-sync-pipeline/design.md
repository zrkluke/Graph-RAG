## Context

由於專案使用的 Supabase (Postgres) 與 Neo4j 均為免費版服務，其儲存空間、最大連線數以及寫入次數均受到严格限制。因此，我們必須實作增量任務佇列與手動維運後台，但將自動排程設定為「預設關閉」，以環境變數 `ENABLE_AUTO_SYNC` 控制，改以在後台手動觸發批次寫入（例如一次僅同步 10 筆或 20 筆），這能兼顧「開發新功能」與「保護免費額度不被無效耗盡」的要求。

## Goals / Non-Goals

**Goals:**
- 在 Supabase Postgres 中建立 `verdict_sync_jobs` 資料表。
- 實作 `/admin` 後台管理介面，包含 Pending / Processing / Completed / Failed 統計、失敗任務詳情列表。
- 實作手動控制按鈕：執行手動增量同步、一鍵重試失敗任務、手動執行社群偵測（LPA）。
- 控制 Neo4j 寫入併發度（Concurrency = 2）以防範死結並降低連線負載。

**Non-Goals:**
- 不向 `vercel.json` 註冊自動 Cron 排程。
- 不修改歷史資料全量重新分塊（保留供後續單獨排程）。

## Decisions

- **環境變數控制排程啟用狀態**：
  - 於 `/api/admin/sync` 中，若自動排程觸發但環境變數 `ENABLE_AUTO_SYNC !== 'true'`，則直接跳過不予執行。
- **手動同步批次限制**：
  - 後台發送的同步請求可自訂限制筆數（`limit` 參數，預設 10-20 筆），防止 Serverless 逾時。
- **社群偵測（LPA）的解耦手動執行**：
  - LPA 運算需要獲取全圖拓撲關係並回寫，資源消耗較高。我們將其封裝為 `/api/admin/community-detection` 由管理員在資料增量更新後手動單次觸發。

## Risks / Trade-offs

- **[Risk] 手動同步大批量資料時超時 (Timeout)**
  - **緩解措施**: 提供數量滑桿或輸入欄，讓管理員自由決定本次同步 10、20 或 50 筆。使用 `p-limit` 限制寫入併發以平穩流量。
- **[Risk] 頻繁執行社群偵測導致 Neo4j 超載**
  - **緩解措施**: 後台設有防重複觸發按鈕，且此功能非自動執行，完全由管理員手動把控。
