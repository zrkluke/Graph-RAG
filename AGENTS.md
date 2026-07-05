# 法律判決書 Graph RAG 搜尋系統 — AI Agent 開發指引 (AGENTS.md)

本文件專為協助本專案的 AI 編碼助手（如 Cursor, Claude 等）所撰寫。當您在此專案中進行後續開發、規格編寫或程式碼修改時，請嚴格遵循以下設定的世界觀、系統架構與部署策略。

---

## 1. 專案世界觀與目標

### 1.1 目標
建構一個 **智慧型法律判決書搜尋與圖譜分析系統**：
1. **資料處理**：從司法院 OpenData 擷取判決書文本。進行雙寫導入：
   * **PostgreSQL (Supabase)**：儲存判決書全文、段落結構（Sections）與文字切片（Chunks），並對切片進行向量化。
   * **Neo4j**：抽取關鍵實體（如被告、原告、法官、引用法條、罪名、關鍵事證）並寫入關聯邊，僅保留輕量化判決書 ID 骨架。
2. **語義與篩選搜尋**：使用者輸入一段「自然語言情境描述」，系統透過 Postgres 進行向量與三連字元全文混合檢索，並送至 Neo4j 進行實體關係（法官、法規等）硬約束過濾與多跳案例推薦，最後在記憶體進行 RRF 分數融合與長文本裝配。

### 1.2 技術限制與省錢策略（Free Tier 部署計畫）
為達成「最低成本」甚至「完全免費」的部署需求，我們採用 **「圖文分離 (Polyglot Decoupling)」** 雙資料庫架構：

1. **圖資料庫 (Neo4j AuraDB Free)**: 
   * 免費版限制最多 200,000 個節點與 400,000 條關係。
   * **圖文分離設計**：完全刪除 Neo4j 中的 `Section` 與 `Chunk` 節點，並抽離長文字與 1536 維向量屬性。這讓 10 萬筆判決在 Neo4j 中僅耗用數萬節點，**徹底解決免費版容量上限**！
2. **關係與向量資料庫 (Supabase PostgreSQL)**:
   * 提供免費版 PostgreSQL 資料庫。
   * 啟用 **`pgvector`** 插件進行 chunks 向量儲存與 HNSW Cosine 相似度快速檢索。
   * 啟用 **`pg_trgm`** (Trigram) 擴充以建立三連字元 GIN 索引，為中文模糊 ILIKE 檢索提供免分詞器的毫秒級索引加速。
3. **Web 應用程式與 API (Vercel Next.js)**:
   * 使用 Next.js 的 Serverless Route Handlers 直接連接 Postgres 與 Neo4j AuraDB，實現 0 元部署。
4. **Redis 快取層 (Upstash Redis)**:
   * 緩存搜尋結果（TTL 3 天），大幅降低 OpenAI Embedding 的 Token 消耗。

---

## 2. 系統架構設計

```
              ┌────────────────────────────────────────────────────────┐
              │                     Vercel 雲端平台                     │
              │                                                        │
              │  ┌─────────────────┐                                   │
              │  │  Next.js 前端   │                                   │
              │  │  (React UI)     │                                   │
              │  └────────┬────────┘                                   │
              │           │ (HTTP)                                     │
              │           ▼                                            │
              │  ┌─────────────────┐    ┌─────────────┐  ┌──────────┐  │
              │  │ Next.js API 路由│───▶│ OpenAI API  │  │ Upstash  │  │
              │  │ (Serverless API)│    │ (Embedding) │  │  Redis   │  │
              │  └────┬────────┬───┘    └─────────────┘  └────┬─────┘  │
              └───────┼────────┼──────────────────────────────┼────────┘
                      │        │ (Bolt over TLS)              │ (Cache Hit/Miss)
     (SQL / pgvector) │        ▼                              ▼
                      │  ┌─────────────────────────────────────────────┐
                      │  │              Neo4j AuraDB Free              │
                      │  │                                             │
                      │  │  • Judgment (僅保留ID等Metadata骨架)         │
                      │  │  • Entity (被告/原告/法官/法條/罪名/事證)   │
                      │  │  • No Section or Chunk Nodes                │
                      │  └─────────────────────────────────────────────┘
                      ▼
              ┌────────────────────────────────────────────────────────┐
              │                   Supabase Postgres                    │
              │                                                        │
              │  • judgments 表 (儲存 main_text、fact_reason 全文)       │
              │  • sections 表  (段落結構)                             │
              │  • chunks 表    (文字切片與 1536維 pgvector 向量)      │
              └────────────────────────────────────────────────────────┘
```

---

## 3. 資料庫 Schema 設計

### 3.1 PostgreSQL 實體表與索引
1. **`judgments` (主表)**:
   * `id`: `VARCHAR(100) PRIMARY KEY` (判決字號)
   * `court`, `court_level`, `case_type`, `date`, `reason`
   * `main_text`, `fact_reason` (長文本全文)
   * *索引*：對 `main_text` 與 `fact_reason` 建立 `gin_trgm_ops` 索引以提供 GIN 全文模糊檢索加速。
2. **`sections` (段落表)**:
   * `id` (`PRIMARY KEY`), `judgment_id` (`FOREIGN KEY`), `index`, `role`, `type`, `text`
3. **`chunks` (切片表)**:
   * `id` (`PRIMARY KEY`), `judgment_id` (`FOREIGN KEY`), `section_id` (`FOREIGN KEY`), `index`, `text`
   * `embedding`: `VECTOR(1536)`
   * *索引*：建立 `hnsw` 索引搭配 `vector_cosine_ops` 進行向量快速查詢。

### 3.2 Neo4j 圖譜節點與關係
1. **`Judgment` (判決骨架)**:
   * `id`: `String` (PK)
   * `court`, `court_level`, `case_type`, `date`, `reason` (無長文本，無向量屬性)
2. **`Entity` (關聯實體)**:
   * **`Person`**: 法官、原告、被告、訴訟代理人。
   * **`Law`**: 引用法條，如 `中華民國刑法第185-3條`。
   * **`Crime` (罪名)**: 如 `公共危險`、`過失傷害`。
   * **`Item` (關鍵事證)**: 如 `呼氣酒精濃度`、`安非他命`、`西瓜刀`。
3. **關係線**:
   * `(:Judgment)-[:JUDGED_BY]->(:Person)` (裁判法官)
   * `(:Judgment)-[:DEFENDANT]->(:Person)` (被告人)
   * `(:Judgment)-[:CITED]->(:Law)` (引用法條)
   * `(:Judgment)-[:CHARGED_WITH]->(:Crime)` (涉及罪名)
   * `(:Judgment)-[:FOUND_WITH]->(:Item)` (涉及關鍵事證)
   * `(:Judgment)-[:SIMILAR_TO {score: Float}]->(:Judgment)` (共享法規二跳推薦關係)

---

## 4. 搜尋與檢索演算法 (Search Pipeline)

1. **快取檢索與雜湊**：對前端傳參的 JSON 計算 MD5，命中 Redis 則直接回傳（TTL 3 天）。
2. **向量化**：將情境 Query 透過 OpenAI 轉換為 1536 維向量。
3. **分散式雙庫聯合查詢 (Orchestration)**：
   * **第一步：並行 Postgres 檢索**：
     * **向量檢索**：向 Postgres `chunks` 表以 HNSW 索引查詢 Cosine 相似度最高的 50 筆 `judgment_id`。
     * **全文檢索**：向 Postgres `judgments` 表以三連字元 GIN 索引或 `websearch_to_tsquery` 檢索最相符的 50 筆 `judgment_id`。
     * **硬過濾前置**：法院層級、案件種類、指定法院直接在 SQL 中執行過濾。
   * **第二步：Node.js 中進行 RRF 融合排序**：
     * 對兩大管道候選集進行 Reciprocal Rank Fusion，平滑常數經評測以 **`k=10`** 為最佳調優參數。
   * **第三步：並行關係過濾與詳情撈取**：
     * 將 RRF 排序後的前 N 筆 IDs 分送：
       * **Neo4j**：進行法官、法規強過濾約束，並撈取一跳關聯實體、二跳推薦相似案件與 Leiden 社群命名。
       * **Postgres**：執行 `WHERE id = ANY($1)` 一次性撈取對應判決的主文與事實理由全文。
     * **記憶體裝配**：將兩邊資料在 Node.js 中合併組裝回傳。

---

## 5. 圖譜非同步展開與懶加載 (Graph Expansion)

* **二跳擴展 API (`/api/graph/expand`)**：
  * **法條節點 (`law`)**：雙擊展開引用了該法規的最新的 8 筆判決書。
  * **人物節點 (`person`)**：雙擊展開與該法官或當事人相關聯的最新的 8 筆判決書。
  * **判決書節點 (`judgment`)**：雙擊展開與該判決書共享最多引用法規的最相似 5 筆判決書（SIMILAR_TO 關係，二跳推薦）。
* 前端 `GraphNetwork.tsx` 使用 `vis-network` 的 `DataSet` 管理 `nodes` 與 `edges`，雙擊時調用展開 API 獲取鄰接節點與關係，利用 `DataSet.add` 動態增量寫入並去重。

---

## 6. 開發指南與階段任務

作為開發代理人，在接續的工作中請遵守：
1. **規格與實作計畫雙向同步**：進行重大代碼重構前，先維護好專案 OpenSpec 規格，並於變更完成後手動將專案變更目錄歸檔至 `openspec/changes/archive/`。
2. **評測基準 (Recall@K)**：評估檢索演算法時，請一律使用標準資訊檢索指標 **`Recall@3`** 與 **`Recall@5`**。
3. **語系規範**：本專案的所有代碼註解、說明、終端輸出與前端 UI，一律採用繁體中文 (Traditional Chinese)。
