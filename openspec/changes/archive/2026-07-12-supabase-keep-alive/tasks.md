## 1. 核心程式碼修改

- [x] 1.1 在 `frontend/src/app/api/cron/keep-alive/route.ts` 中導入 `getPostgresPool` 函數。
- [x] 1.2 在該 API 路由的 `GET` 處理常式中，建立 PostgreSQL 的心跳查詢 `SELECT 1 AS alive;`。
- [x] 1.3 整合 Neo4j 與 PostgreSQL 的執行狀態，當任一查詢失敗時，返回 500 錯誤與詳細日誌。

## 2. 測試與驗證

- [x] 2.1 執行本地開發伺服器，手動呼叫 `/api/cron/keep-alive` 路由並驗證回傳的 JSON 包含 Neo4j 及 PostgreSQL 心跳成功訊息。
