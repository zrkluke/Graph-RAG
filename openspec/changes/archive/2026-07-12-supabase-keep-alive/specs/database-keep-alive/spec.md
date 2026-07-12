## ADDED Requirements

### Requirement: 定時心跳與多資料庫保活機制
系統 SHALL 提供一個特定的 API 路由，用以定時被 Vercel Cron 觸發，同時向 Neo4j 及 Supabase (PostgreSQL) 資料庫執行心跳與保活查詢，以重置其閒置暫停倒數計時器。

#### Scenario: 成功觸發心跳查詢
- **WHEN** 發送 GET 請求至 `/api/cron/keep-alive` 且通過安全性驗證時
- **THEN** 系統將同時連接 Neo4j 寫入 `Heartbeat` 節點且連接 Supabase Postgres 執行 `SELECT 1` 查詢，並回傳包含兩者執行結果的成功 JSON 回應。

#### Scenario: 未授權的排程呼叫拒絕
- **WHEN** 在生產環境（production）下，發送未攜帶正確 `CRON_SECRET` 授權金鑰的 GET 請求至 `/api/cron/keep-alive`
- **THEN** 系統必須拒絕該請求並回傳 HTTP 401 Unauthorized 狀態碼。
