## Why

由於專案使用的 Supabase (PostgreSQL)、Neo4j AuraDB 與 Upstash Redis 皆為免費託管方案，在一段時間沒有任何流量/活動時會被暫停或關閉：
1. **Supabase (PostgreSQL)**：超過 7 天無活動將被暫停。先前實作的 `SELECT 1;` 為直連 TCP 輕量查詢，但可能未觸發實體表讀寫，或因 Vercel 部署排程未就緒導致並未真正定時執行。
2. **Upstash Redis**：數週內無 traffic 將被自動封存。先前實作的 `/api/cron/keep-alive` 完全漏掉了對 Redis 的保活心跳。

為了保證服務持續在線，我們需要優化 `/api/cron/keep-alive` 以涵蓋 Redis 保活，並優化 Postgres 保活查詢。

## What Changes

- 在 `frontend/src/app/api/cron/keep-alive/route.ts` 中加入 Redis 心跳保活 (PING & SET)。
- 將 Postgres 心跳優化為對 `judgments` 表的實體讀取。
- 提供手動與自動保活的檢驗方式。

## Capabilities

### New Capabilities

- `redis-keep-alive`: 自動對 Upstash Redis 進行心跳寫入以維持活躍狀態。
- `optimized-postgres-keep-alive`: 透過對實體表的查詢提升保活成功率。
