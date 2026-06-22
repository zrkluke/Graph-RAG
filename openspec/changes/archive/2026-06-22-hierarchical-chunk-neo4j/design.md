## Context

目前的判決書搜尋系統直接將大段落 `Section` 節點進行向量化，並在補全向量時將長度強行截斷至前 5000 字元。這會遺失長判決書後半部的重要法律理由，且會導致 1536 維向量的語意稀釋。

本設計旨在引入「階層式 Chunk 節點」架構，在保留大段落 `Section` 語意結構的同時，下沉向量檢索層級至 1000 字以內的 `Chunk` 節點，以實現高精度、不超 Token 限制的 Graph RAG 檢索。

## Goals / Non-Goals

**Goals:**
- 在 Neo4j 中建立 `Chunk` 節點及 `(Section)-[:HAS_CHUNK]->(Chunk)` 的關係。
- 實作無外部庫依賴（或輕量級）的中文遞迴字元切分器，設定 `chunk_size = 1000`, `chunk_overlap = 150`。
- 修改 `import_judgments.py` 以支援階層式 Chunks 的資料庫寫入。
- 修改 `update_embeddings.py` 使向量化與索引對象轉移至 `Chunk` 節點。
- 修改 `search_pipeline.py` 與前端 API，使其在向量檢索命中 `Chunk` 後，能透過 Cypher 向上還原 `Section` 及 `Judgment` 的完整上下文。

**Non-Goals:**
- 修改現有的命名實體識別 (NER) 與關係抽取邏輯。
- 引入複雜的第三方 PDF/OCR 解析器。
- 修改 OpenSearch (本專案目前主要以 Neo4j 為核心圖資料庫儲存)。

## Decisions

### 1. Chunking 切割器實作
*   **決策**：在 `judgment_splitter.py` 中實作一個輕量、無外部依賴的遞迴字元切割器（Recursive Character Splitter）。
*   **原因**：避免引入如 LangChain 等龐大的外部庫依賴。該切割器將優先以中文自然段落與標點（`\n\n` -> `\n` -> `。` -> `；` -> `，`）為切分點，在保證不超過 1000 字的同時，保留句子語意的完整性。
*   **備選方案**：使用固定長度硬切。但這會導致句子在邊界處被攔腰切斷，造成語意嚴重受損。

### 2. Neo4j 資料儲存結構
*   **決策**：建立複數個 `Chunk` 節點，並與 `Section` 節點建立關係：
    `(:Section {id}) -[:HAS_CHUNK {index}]-> (:Chunk {id, text, embedding})`
*   **原因**：這樣做能將 Section 的結構意義（如原告主張、法院理由）與細粒度的檢索語意（Chunk）分離。在向量檢索時只檢索 `Chunk`，但能輕鬆透過圖關係找回其所屬的 `Section` 屬性。

### 3. 上下文重組與 LLM 餵入策略
*   **決策**：在搜尋時，當向量檢索命中 Top K 個 `Chunk`，我們不直接將這些 `Chunk` 的文字拼裝給 LLM，而是藉由關係 `(s:Section)-[:HAS_CHUNK]->(c:Chunk)` 向上取得該 `Section` 的完整原始文字（`s.text`）送給 LLM。
*   **原因**：相鄰 Chunk 之間存在 Overlap 重疊文字。若直接拼接 Chunks 會造成 LLM 閱讀重複的內容。向上取得 `Section` 的完整文字能保證提供給 LLM 最完整、無重疊的流暢脈絡，且 10000 字以內的 Section 送入 LLM（約 15k token）在現代模型（如 Gemini 3.5）的上下文視窗中非常輕鬆。

## Risks / Trade-offs

*   **[Risk] Neo4j AuraDB Free 的 200,000 節點限制**：
    *   **影響**：引入 Chunk 節點會使資料庫中的節點總量增加約 2 - 3 倍。如果匯入過多大容量判決書，可能會突破免費版額度上限。
    *   **緩解方案**：在開發階段，僅匯入 `limit` 限制內的樣本數據（如 50 - 100 筆判決書）。在生產環境中，若達到上限，可考慮僅對 `type = "reasoning"` (得心證理由) 與 `type = "facts"` (犯罪事實) 這類核心 Section 建立 Chunk 節點，忽略程序或訴訟代理人等無關紧要的 Section。
