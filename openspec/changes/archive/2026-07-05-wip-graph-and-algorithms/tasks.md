# Tasks: Postgres + Neo4j 雙資料庫圖文分離待辦清單 (wip-graph-and-algorithms)

## 1. 資料庫基礎建設與 Schema 初始化
- [x] **任務 1.1**：於 `frontend` 專案中安裝 `pg` 與開發型別 `@types/pg`。
- [x] **任務 1.2**：於 `.env.local` 補上 PostgreSQL (Supabase) 連線字串 `DATABASE_URL`。
- [x] **任務 1.3**：建立 Postgres 連線管理模組 `frontend/src/lib/postgres.ts`。
- [x] **任務 1.4**：撰寫並執行初始化腳本 `frontend/src/scripts/init_postgres.ts`，建立 `judgments`, `sections`, `chunks` 資料表並配置 `pgvector` HNSW 索引。

## 2. Ingestion Pipeline 雙寫導入重構
- [x] **任務 2.1**：擴充 NER 機制，支援 `:Crime`（罪名）與 `:Item`（關鍵事證）實體抽取。
- [x] **任務 2.2**：重構 `import_judgments.ts` 以支援雙寫管線：
  - 先批次插入至 Postgres 的 `judgments`, `sections`, `chunks` 關聯表（含 1536 維向量）。
  - 後寫入 Neo4j，僅保留 `Judgment` 骨架與 `:CITED`、`:DEFENDANT`、`:CHARGED_WITH` 等實體邊關係，**完全移除 Section 與 Chunk 節點**。
- [x] **任務 2.3**：撰寫維運清理腳本，清除 Neo4j 雲端資料庫中現有的所有 `:Section` 與 `:Chunk` 舊節點，釋放 AuraDB 容量。
- [x] **任務 2.4**：重構 `community_detection.ts`，使其在計算社群（LPA）時僅依據 `(:Judgment)-[:CITED]->(:Law)` 的拓撲，不依賴 Section 關係。

## 3. 搜尋 API (Orchestration) 重構
- [x] **任務 3.1**：重構 `/api/search/route.ts` 候選檢索邏輯：
  - **向量檢索**：改向 Postgres 的 `chunks` 表查詢 cos 相似度並以 `judgment_id` 聚合。
  - **全文檢索**：改向 Postgres 的 `judgments` 全文檢索索引查詢。
- [x] **任務 3.2**：重構 RRF 融合後的詳情撈取邏輯：
  - 拿著 Top N 判決 IDs，向 Neo4j 批次查詢關聯法官、被告、引用法規、法律分群以及二跳相似案件推薦。
  - 同時向 Postgres 撈取對應的 `main_text` / `fact_reason` 全文以裝配回傳。
- [x] **任務 3.3**：驗證進階過濾器（法官、法院、引用法規）在雙資料庫串接下的運作正確性。

## 4. 檢索品質評估與調優
- [x] **任務 4.1**：建立黃金測試集並實作檢索品質評估腳本。
- [x] **任務 4.2**：藉由評估測試集調優 Hybrid RRF 的最佳平滑常數 k 值。
- [x] **任務 4.3**：啟用 Postgres pg_trgm 擴充與 GIN Trigram 索引優化中文模糊檢索效能。


