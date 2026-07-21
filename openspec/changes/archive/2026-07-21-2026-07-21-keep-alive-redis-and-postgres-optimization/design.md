# Design: 遠端資源保活機制優化

## 1. 系統架構與保活對象
目前系統主要依賴的三個外部雲端資源：
- **Neo4j AuraDB Free**（自動保活已實作：使用 `Heartbeat` 節點寫入 `lastSeen` 屬性）
- **Supabase PostgreSQL**（已實作但需優化：原使用 `SELECT 1;`，改為 `SELECT id FROM judgments LIMIT 1;`）
- **Upstash Redis**（未實作：在此變更中加入 `PING` 與 `SET` 保活鍵）

```
                  ┌──────────────────────┐
                  │  Vercel Cron Job     │
                  └──────────┬───────────┘
                             │ (每2天)
                             ▼
               ┌──────────────────────────┐
               │ /api/cron/keep-alive     │
               └────┬─────────┬────────┬──┘
                    │         │        │
      (Heartbeat    │         │        │ (PING / SET)
       Cypher)      │         │        ▼
                    ▼         │   ┌───────────────┐
              ┌───────────┐   │   │ Upstash Redis │
              │   Neo4j   │   │   └───────────────┘
              └───────────┘   ▼
                       ┌──────────────┐
                       │   Supabase   │
                       │ (PostgreSQL) │
                       │ SELECT id... │
                       └──────────────┘
```

## 2. API 實作設計
在 `/api/cron/keep-alive` 中：
1. **Redis 心跳**：
   - 獲取 `getRedisClient()`。
   - 執行 `redis.ping()` 驗證連線。
   - 執行 `redis.set('heartbeat:keep-alive', new Date().toISOString(), 'EX', 86400)` 確保有資料變更寫入流量。
2. **Postgres 心跳**：
   - 執行 `pool.query('SELECT id FROM judgments LIMIT 1;')` 確保對實體表有查詢活動，避免被 API 網關判定為無實質查詢的閒置連接。
