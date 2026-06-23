# Proposal: 導入 GCP VM Redis 快取與 Supabase Postgres 任務佇列架構 (redis-cache-and-postgres-queue)

## 1. 摘要 (Summary)
為了提升系統搜尋效能並建立可靠的增量資料同步機制，本提案建議採用 Polyglot (多資料庫並存) 架構：
1. **本機 GCP VM (Redis)**：建立極速的記憶體快取 (Cache)，快取 OpenAI Embedding 與 Neo4j 搜尋結果，降低 API 成本與資料庫壓力。
2. **雲端 Supabase (Postgres)**：建立高可靠的 Job Queue 表，用於 Ingestion 任務緩衝佇列，解決 Vercel Serverless 的 10 秒執行逾時限制，並提供失敗任務的觀測與重試機制。

## 2. 動機與背景 (Motivation & Background)
* **搜尋效能與成本**：目前每次自然語言搜尋都必須即時呼叫 OpenAI Embedding API（消耗 Token 並產生計費）以及連線雲端 Neo4j 進行複雜的圖譜檢索。
* **Serverless 限制**：Vercel 增量資料同步極花時間（需下載、清洗、切分、向量化與寫入），在 Serverless Function 10 秒超時限制下必定失敗。
* **防封鎖需求**：大量請求同時向司法院發送容易被防爬蟲系統封鎖 IP，必須透過 Queue 進行速率限制（Rate Limiting）。

## 3. 解決方案 (Proposed Solution)
* **快取層 (Redis)**：
  * 在免費 GCP e2-micro VM 上部署 Redis，Next.js API 搜尋時先查 Redis，若命中則直接回傳（搜尋時間縮短至 <10ms）。
  * 實施 LRU 快取過期策略。
* **佇列層 (Postgres)**：
  * 在免費的 Supabase Postgres 建立 `jobs` 表（含 `jid`、`status`、`error_message`、`retry_count`）。
  * Vercel Cron 每秒或每日定時發布任務至該表。
  * GCP VM 上的 Ingestion Worker 每一分鐘 Pull 新任務，限制速率以 1 筆/秒 寫入 Neo4j。
  * 實作管理後台儀表板顯示同步狀態並支援一鍵重試。

## 4. 影響評估 (Impact)
* **優點**：
  * 0 成本部署（GCP Free VM, Supabase Free Tier）。
  * 搜尋反應速度暴增，且降低 OpenAI API 費用。
  * 系統極度穩定，具備重試與失敗日誌記錄。
* **缺點**：
  * 系統架構複雜度上升，需要同時管理多個連線與環境變數。
