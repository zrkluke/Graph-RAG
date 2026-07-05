# Proposal: Postgres + Neo4j 雙資料庫圖文分離架構與演算法優化 (wip-graph-and-algorithms)

## 1. 摘要 (Summary)
為了解決雲端免費版 Neo4j AuraDB (20 萬節點限制) 在面對大文本切片 (Chunks) 時容易容量溢出的痛點，本提案建議將系統全面重構為 **「圖文分離 (Polyglot Decoupling)」** 架構：
1. **PostgreSQL (Supabase)**：負責「血肉」。儲存所有判決書全文、Sections、Chunks 及 1536 維的 Chunks 向量 Embeddings，並用 `pgvector` 提供極速的 ANN 向量檢索。
2. **Neo4j (AuraDB Free)**：負責「骨架」。僅儲存 `Judgment(ID/Metadata)` 骨架，以及連接著的 `Person`、`Law`、`Crime` 關係網絡，刪除 Section 與 Chunk 節點，實現極致輕量化，專注於多跳關係走訪與圖演算法。

本提案同時包含對圖譜 Schema 擴充（罪名與事證）、分數正規化與檢索品質評估。

## 2. 核心設計構想 (Design Concepts)
* **圖文分離儲存**：將長文本與向量移出 Neo4j，Neo4j 節點量縮減 90% 以上，避開 Free Tier 上限。
* **向量與全文搜尋回歸 Postgres**：利用 Supabase PG 的 `pgvector` 做向量比對，並以 GIN 索引做全文檢索，極速產出 Top 50 候選 `judgment_id` 列表。
* **圖譜關係擴展與硬約束**：Next.js API 獲取候選 ID 後，向 Neo4j 發起 Cypher 批次查詢以進行法官/法條的強約束過濾、Leiden 社群分群計算與二跳相似案例推薦。
* **分數正規化與評估**：建立量化測試集，並對 Postgres 向量相似度與全文檢索分數進行融合排序調優 (RRF)。
