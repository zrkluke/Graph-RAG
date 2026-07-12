## ADDED Requirements

### Requirement: 任務佇列資料表規格
系統 SHALL 於 Supabase PostgreSQL 中包含 `verdict_sync_jobs` 資料表，用以追蹤與管理待同步的判決書任務狀態（包括 pending, processing, completed, failed）。

#### Scenario: 成功讀取任務統計與錯誤詳情
- **WHEN** 調用 `/api/admin/jobs` 的 GET 請求時
- **THEN** 系統 SHALL 回傳包含 pending、processing、completed、failed 數量統計及最近 10 筆失敗任務資訊的 JSON 資料。

### Requirement: 視覺化管理與維運後台 UI
系統 SHALL 於 `/admin` 提供管理後台網頁，展示資料庫狀態與任務佇列統計，並提供操作按鈕執行手動批量同步、一鍵重試失敗任務與手動 LPA 社群偵測。

#### Scenario: 手動點擊一鍵重試失敗任務
- **WHEN** 管理員於後台點擊「一鍵重試失敗任務」並發送 POST 請求至 `/api/admin/jobs` 時
- **THEN** 系統 SHALL 將資料庫中所有狀態為 `failed` 的任務重設為 `pending`，重試次數歸零，並回傳成功狀態。

### Requirement: 限流與防死結的任務同步 API
系統 SHALL 提供 `/api/admin/sync` 路由以執行增量資料同步。此 API 在執行寫入資料庫時，限制最大併發（Concurrency）數為 2 以防範 Neo4j 死結，且預設由 `ENABLE_AUTO_SYNC` 環境變數保護，若非設定為 "true" 則自動觸發時跳過執行，僅允許從後台手動觸發。

#### Scenario: 環境變數保護未啟用自動排程同步
- **WHEN** 發送 POST 請求至 `/api/admin/sync` 且環境變數 `ENABLE_AUTO_SYNC` 未設定或不為 "true" 且無手動強制標記時
- **THEN** 系統 SHALL 跳過自動增量同步並回傳成功訊息，防止耗盡免費資源。
