# hierarchical-chunking Specification

## Purpose
TBD - created by archiving change hierarchical-chunk-neo4j. Update Purpose after archive.
## Requirements
### Requirement: 段落遞迴切分與 Overlap
系統在匯入判決書時，對於事實及理由中的每一個 `Section`（大段落），若字數大於 1000 字，必須（SHALL）使用遞迴字元切分（Recursive Character Splitting）將其切分為小於 1000 字的複數個 `Chunk`，並保有 150 字的 Overlap，且不得漏字。

#### Scenario: 長 Section 切分成功
- **WHEN** 判決書的 `reasoning` 段落長度為 2500 字，且 `chunk_size` 設為 1000，`chunk_overlap` 設為 150。
- **THEN** 系統將該段落切分為 3 個 Chunks，每個 Chunk 的文字長度皆小於 1000 字，且相鄰 Chunk 間存在 150 字的重疊，最後無漏字。

### Requirement: Chunk 節點與 Neo4j 圖關聯建立
系統在寫入 Neo4j 時，必須（SHALL）為每個切片建立 `Chunk` 節點，並建立 `(s:Section)-[:HAS_CHUNK {index: idx}]->(c:Chunk)` 的關係。`Chunk` 節點必須包含 `id` 與 `text` 屬性。

#### Scenario: 成功寫入 Chunk 節點與關聯
- **WHEN** 執行匯入指令且判決書被成功處理。
- **THEN** Neo4j 中成功建立對應的 `Chunk` 節點，且透過 `HAS_CHUNK` 關係依序與其所屬 `Section` 相連，且 `Chunk` 的文字內容與 `text` 屬性一致。

### Requirement: 向量生成對象下沉
系統在執行向量化補全時，必須（SHALL）掃描所有 `embedding` 屬性為空的 `Chunk` 節點（而非 `Section` 節點），使用 OpenAI Embedding API（`text-embedding-3-small`）生成 1536 維的向量，並將其更新回該 `Chunk` 節點的 `embedding` 屬性上，同時必須（SHALL）建立針對 `Chunk` 節點的向量索引。

#### Scenario: 成功補全 Chunk 向量
- **WHEN** 呼叫向量更新腳本且資料庫中存有未向量化的 Chunk 節點。
- **THEN** 所有 Chunk 節點的 `embedding` 屬性均被成功更新，且向量維度為 1536，且向量索引處於可用狀態。

### Requirement: 混合檢索上下文還原
系統在進行語意搜尋時，必須（SHALL）針對 `Chunk` 節點進行向量檢索，並在檢索出相似的 `Chunk` 後，透過圖關係向上還原其所屬的 `Section` 甚至取得其相鄰的 `Chunk` 內容，重組完整的上下文提供給 LLM 進行生成。

#### Scenario: 向量檢索與上下文還原
- **WHEN** 使用者輸入自然語言查詢並送出檢索。
- **THEN** 系統透過向量檢索尋找 Top K 相似的 Chunks，並透過 Cypher 查詢向上追蹤其 `Section` 與 `Judgment` 節點，成功還原出所屬大段落的完整上下文。

