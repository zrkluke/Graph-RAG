# Design: Postgres + Neo4j 雙資料庫圖文分離設計規格 (wip-graph-and-algorithms)

本文件詳述「圖文分離 (Polyglot Decoupling)」架構的底層資料模型設計、雙寫導入管線 (Ingestion Pipeline) 與搜尋協調流程 (Search Orchestration)。

---

## 1. 資料庫模型設計 (Data Schema)

### 1.1 PostgreSQL (Supabase) - 「血肉」
負責高容量的文本與向量儲存。啟用 `pgvector` 與 `cjk` 全文檢索支援。

```sql
-- 啟用向量擴充
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 判決書主表
CREATE TABLE IF NOT EXISTS judgments (
    id VARCHAR(100) PRIMARY KEY,
    case_type VARCHAR(20) NOT NULL,
    court VARCHAR(100) NOT NULL,
    court_level VARCHAR(50) NOT NULL,
    date DATE,
    reason VARCHAR(255),
    main_text TEXT,
    fact_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 判決書段落表 (Section)
CREATE TABLE IF NOT EXISTS sections (
    id VARCHAR(150) PRIMARY KEY, -- 格式: {judgment_id}_sec_{index}
    judgment_id VARCHAR(100) REFERENCES judgments(id) ON DELETE CASCADE,
    index INT NOT NULL,
    role VARCHAR(50),
    type VARCHAR(50),
    text TEXT NOT NULL
);

-- 3. 文本切片表 (Chunk)
CREATE TABLE IF NOT EXISTS chunks (
    id VARCHAR(200) PRIMARY KEY, -- 格式: {section_id}_chk_{index}
    section_id VARCHAR(150) REFERENCES sections(id) ON DELETE CASCADE,
    judgment_id VARCHAR(100) REFERENCES judgments(id) ON DELETE CASCADE,
    index INT NOT NULL,
    text TEXT NOT NULL,
    embedding VECTOR(1536) -- OpenAI text-embedding-3-small 向量
);

-- 建立 HNSW 向量索引 (Cosine 距離)
CREATE INDEX IF NOT EXISTS chunks_hnsw_idx 
ON chunks USING hnsw (embedding vector_cosine_ops);

-- 建立 judgments 全文檢索 GIN 索引
CREATE INDEX IF NOT EXISTS judgments_text_gin_idx 
ON judgments USING gin (to_tsvector('parser_cjk', main_text || ' ' || fact_reason));
```

### 1.2 Neo4j (AuraDB) - 「骨架」
僅保留實體與關係。刪除原有的 `Section` 與 `Chunk` 節點。

* **節點類型 (Node Labels)**：
  - `Judgment`: 只保留 `{id, case_type, court, court_level, date, reason}` 等高階 metadata，不儲存 `main_text` 與 `fact_reason` 長文本以極致壓縮容量。
  - `Person`: `{name}`
  - `Law`: `{name}`
  - `Crime`: `{name}` [NEW]
  - `Item`: `{name}` [NEW]
* **關係類型 (Relationship Types)**：
  - `(:Judgment)-[:JUDGED_BY]->(:Person)`
  - `(:Judgment)-[:DEFENDANT]->(:Person)`
  - `(:Judgment)-[:PLAINTIFF]->(:Person)`
  - `(:Judgment)-[:REPRESENTED_BY]->(:Person)`
  - `(:Judgment)-[:CITED]->(:Law)`
  - `(:Judgment)-[:CHARGED_WITH]->(:Crime)`
  - `(:Judgment)-[:SIMILAR_TO {score: Float}]->(:Judgment)`

---

## 2. 雙寫資料導入管線 (Ingestion Pipeline)

資料寫入時採取 **Postgres 優先，Neo4j 後隨** 的原則：

```
     [判決書 JSON 檔案]
            │
            ▼
     [文本清洗與實體提取]
      - 提取當事人、法規、罪名與事證
      - 進行 Chunks 切片與向量化
            │
      ┌─────┴────────────────────────┐
      ▼                              ▼
[寫入 PostgreSQL]               [寫入 Neo4j]
 1. 寫入 judgments 表            1. 寫入 Judgment (僅 id/metadata)
 2. 批次寫入 sections 表          2. 批次建立 Person, Law, Crime
 3. 批次寫入 chunks 與向量        3. 批次建立 CITED, DEFENDANT 等關係
```

---

## 3. 搜尋協調流程 (Search Orchestration)

搜尋 API 轉為**分散式檢索協調器**，流程如下：

```
                      [用戶自然語言輸入]
                             │
                             ▼
                    [OpenAI Embedding]
                             │
               ┌─────────────┴─────────────┐
               ▼                           ▼
      [Postgres 向量檢索]           [Postgres 全文檢索]
      - 在 chunks 上做 cos 相似     - 在 judgments 上做 tsquery
      - 聚合出 Top 50 判決 ID       - 撈出 Top 50 判決 ID
               │                           │
               └─────────────┬─────────────┘
                             ▼
                    [RRF 混合分數融合]
                    - 篩選出最終 Top N IDs
                             │
                             ▼
                    [Neo4j 關係擴展與過濾]
                    - 批次查詢過濾法官/法條 (強過濾)
                    - 撈取關聯實體、Leiden 社群與二跳相似推薦
                             │
                             ▼
                    [Postgres 文本裝配]
                    - 從 Postgres 撈取最終前 3 筆判決書全文
                             │
                             ▼
                    [LLM 分析生成與回傳]
```
