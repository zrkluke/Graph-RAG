## Why

當前專案將判決書的「事實及理由」區塊切分為 `Section` 節點後直接進行向量化。然而，當部分判決書的論證段落極長時，將會超出 OpenAI Embedding API 的 Token 限制。

目前採取的 `t[:5000]` 粗暴截斷方式會導致兩個嚴重問題：
1. **語意遺失**：長篇判決書後半段的重要法律論理無法被檢索。
2. **語意稀釋**：將數千字壓縮在單一 1536 維向量中，其資訊密度過低，難以精準命中具體子爭點。

因此，亟需引入更細粒度的 Chunking 策略，並將其與 Neo4j 的資料結構做深度結合，以提升 Graph RAG 的精準度與穩定性。

## What Changes

本變更將引入以下調整：
- **[MODIFY]** `judgment_splitter.py`：新增細粒度 text splitter 邏輯，可對 `Section` 段落進行遞迴字元切分（設有 Overlap），產生 1000 字左右的 Chunk 區塊。
- **[MODIFY]** `import_judgments.py`：修改寫入 Neo4j 的 Cypher 語句。改為在寫入 `Section` 節點的同時，進一步建立複數個 `Chunk` 節點，並建立 `(Section)-[:HAS_CHUNK]->(Chunk)` 的關係。
- **[MODIFY]** `update_embeddings.py`：將向量索引的對象由 `Section` 變更為 `Chunk`。向量化腳本掃描所有尚未生成向量的 `Chunk` 節點，並批次發送給 OpenAI 生成向量，寫回 `Chunk` 節點的 `embedding` 屬性。
- **[MODIFY]** `search_pipeline.py`（與前端 API 路由）：修改向量搜尋邏輯，由搜尋 `Section` 改為搜尋 `Chunk`。在搜尋到相似的 Chunk 後，向上溯源查詢關聯的 `Section` 與 `Judgment` 節點以重組完整的上下文。

## Capabilities

### New Capabilities
- `hierarchical-chunking`: 引入階層式 Chunk 節點結構，對長判決書進行重疊切片並寫入 Neo4j，以實現高精度的向量與圖譜混合檢索。

### Modified Capabilities
<!-- 無 -->

## Impact

- **Neo4j Schema 影響**：新增 `Chunk` 節點與 `(Section)-[:HAS_CHUNK]->(Chunk)` 的關係類型。向量索引目標由 `Section` 的 `embedding` 移至 `Chunk` 的 `embedding`。
- **資料庫容量影響**：圖資料庫的節點數量將會因為新增 Chunk 而增加（估計為原 Section 數量的 2-3 倍），需注意 Neo4j AuraDB Free 的 200,000 節點上限。
- **檢索流程影響**：Next.js 前端與 API 路由的 Cypher 檢索與重排邏輯需要隨之調整。
