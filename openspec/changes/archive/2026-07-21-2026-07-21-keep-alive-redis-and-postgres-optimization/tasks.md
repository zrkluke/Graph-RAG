# Tasks: 遠端資源保活機制優化

- [x] 優化保活 API `frontend/src/app/api/cron/keep-alive/route.ts` <!-- id: 0 -->
  - 引入 Redis client 並執行 `ping()` 與 `set()` 保活
  - 修改 Postgres 心跳為實體表讀取 `SELECT id FROM judgments LIMIT 1;`
- [x] 本地測試 API 功能 <!-- id: 1 -->
  - 啟動 Next.js 並請求 `http://localhost:3000/api/cron/keep-alive`
  - 確認 JSON 回傳結果與控制台 Log
- [x] 提供部署指引說明 <!-- id: 2 -->
  - 指導使用者進行 Vercel 部署，並在 Supabase/Upstash 平台上確認/恢復狀態
