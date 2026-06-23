# Design: Redis 快取與 Postgres 任務佇列設計規格 (redis-cache-and-postgres-queue)

## 1. 開發優先順序
本專案將採取**分階段開發**，以利於逐步驗證：
* **階段一：Redis 搜尋快取與前端快取提示**（優先進行，可立即提昇搜尋速度並觀察 Hint）。
* **階段二：Supabase Postgres 任務佇列與背景 Worker**（隨後進行，解決 Vercel Serverless 超時與速率限制）。

---

## 2. 資料庫規格與 docker-compose 整合

### 2.1 本地開發環境：根目錄 `docker-compose.yml`
為了方便 Monorepo 單一存放庫管理，我們在根目錄的 `docker-compose.yml` 中直接追加 `redis` 服務。

```yaml
version: '3.8'
services:
  neo4j:
    image: neo4j:5.26
    container_name: neo4j-apoc
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - ./plugins:/plugins
      - ./data:/data
    environment:
      - NEO4J_AUTH=neo4j/password
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_apoc_export_file_enabled=true
      - NEO4J_apoc_import_file_enabled=true
      - NEO4J_apoc_import_file_use__neo4j__config=true
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*
      - NEO4J_dbms_security_procedures_allowlist=apoc.*
    restart: always

  redis:
    image: redis:7-alpine
    container_name: local-redis
    ports:
      - "6379:6379"
    command: redis-server --requirepass localredispassword --maxmemory 256mb --maxmemory-policy allkeys-lru --appendonly no
    restart: always
```

*GCP VM 部署說明：*
在 GCP VM 部署時，因為不需執行 Neo4j，可以直接執行 `docker compose up -d redis` 來單獨啟動 Redis 容器，這不會增加部署複雜度，且所有設定皆能在 monorepo 統一管理。

### 2.2 Redis 快取設計 (GCP VM)
* **快取鍵值 (Key-Value) 設計**：
  * **鍵值 (Key)**：`search:cache:hash(query+courtLevel+caseType+limit)`
    * 使用 SHA-256 或 MD5 對查詢字串與過濾條件之組合進行 Hash，作為快取 Key。
  * **數值 (Value)**：JSON 字串。儲存 API 格式化後的全文、向量及混合檢索結果（對比數據）。
  * **存活時間 (TTL)**：預設為 `259200` 秒 (3 天)。
* **Redis 配置 (VM Docker)**：
  * 啟用密碼認證 (`requirepass`)。
  * 記憶體淘汰原則：`allkeys-lru` (記憶體滿時自動淘汰最近最少使用的快取)。
  * 關閉或降低 AOF 寫入頻率，以減少 30GB 標準 HDD 硬碟的 I/O 磨損。

### 2.3 Supabase Postgres 任務表設計
在 Supabase 建立 `verdict_sync_jobs` 表：
```sql
CREATE TABLE verdict_sync_jobs (
    id BIGSERIAL PRIMARY KEY,
    jid VARCHAR(100) NOT NULL UNIQUE,         -- 裁判書唯一字號
    status VARCHAR(20) DEFAULT 'pending',     -- pending / processing / completed / failed
    error_message TEXT,                       -- 失敗時的堆疊日誌
    retry_count INT DEFAULT 0,                -- 重試次數
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_status_created ON verdict_sync_jobs(status, created_at);
```

---

## 3. 核心工作流與 API 規格設計

### 3.1 搜尋快取工作流 (Next.js API)
1. 前端向 `/api/search` 發送 POST 請求。
2. 後端計算快取 Key。
3. 連線 GCP Redis 進行讀取：
   * **快取命中 (Cache Hit)**：直接解析 Redis 中的 JSON 回傳前端。
   * **快取未命中 (Cache Miss)**：
     1. 呼叫 OpenAI Embedding 與 Neo4j 進行檢索與圖遍歷。
     2. 格式化結果，非同步寫入 Redis 並設定 3 天 TTL。
     3. 回傳前端。

### 3.2 搜尋 API 回傳格式 (Response Schema)
為了能讓前端顯示執行時間與快取命中提示，`/api/search` 的 Response 格式將新增 `cacheHit` 與 `executionTimeMs`：

```json
{
  "keyword": {
    "results": [...],
    "responseTimeMs": 120
  },
  "vector": {
    "results": [...],
    "responseTimeMs": 280
  },
  "hybrid": {
    "results": [...],
    "responseTimeMs": 290
  },
  "cacheHit": true,             // 表示此查詢是否命中 Redis 快取
  "executionTimeMs": 15         // 整體 API 處理總耗時
}
```

### 3.3 前端快取命中提示 UI
* 當搜尋完成時，若 `cacheHit` 為 `true`，在搜尋結果 Dashboard 區域顯示綠色 Badge，例如 `⚡ 快取命中 (Redis Cache Hit)`，否則顯示 `🔍 即時檢索 (Neo4j Search)`。
* 顯示整體 API 處理總耗時 `⏱️ 總耗時: {executionTimeMs} ms`。

### 3.4 增量同步工作流 (Ingestion Pipeline)
1. **發布端 (Publisher - Vercel Cron)**：
   * 每日凌晨 1:00 觸發。連線司法院 API 獲取最新的 JID 列表。
   * 將這些 JID 批次寫入 Supabase `verdict_sync_jobs`（若已有相同 JID 且狀態非 completed，則更新為 pending）。
2. **消費端 (Consumer - GCP VM Worker)**：
   * 透過 `pm2` 常駐在 GCP VM 上執行。每分鐘向 Supabase 拉取前 20 筆 `pending` 狀態的任務：
     ```sql
     -- 使用 Row Lock 鎖定，防止多個 Worker 重複消費
     UPDATE verdict_sync_jobs
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
         SELECT id FROM verdict_sync_jobs 
         WHERE status = 'pending' 
         ORDER BY created_at ASC 
         LIMIT 20 
         FOR UPDATE SKIP LOCKED
     )
     RETURNING id, jid;
     ```
   * 逐筆拉取裁判書全文，執行 `statute_parser`、`judgment_splitter`，寫入 Neo4j。
   * 控制速率（如 1 筆/秒，利用 `p-limit`）。
   * **執行成功**：更新狀態為 `completed`。
   * **執行失敗**：記錄錯誤日誌至 `error_message`，`retry_count` +1，狀態改為 `failed`。

---

## 4. 安全與防火牆設定 (GCP VM)
* Redis 預設埠口 `6379` 必須受 GCP VPC 防火牆保護，**僅允許 Vercel 的 Serverless API IP（或以安全密碼驗證）存取**，嚴禁公網裸奔。
* Worker 連線至 Neo4j AuraDB 與 Supabase 均採用 Bolt-over-TLS 及 SSL 安全加密連線。
