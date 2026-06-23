## 1. Vector Ingestion & Indexing

- [x] 1.1 在 `scripts/update_embeddings.py` 中，實作對未生成向量之 Section 節點批量調用 OpenAI Embedding API (text-embedding-3-small) 並寫回 Neo4j 的邏輯。
- [x] 1.2 於 `scripts/update_embeddings.py` 啟動時，新增自動檢測與建立 Neo4j `section_embedding_index` 向量索引的 Cypher 指令。

## 2. Hybrid Retrieval Pipeline

- [x] 2.1 實作核心檢索程式 `scripts/search_pipeline.py`，完成情境描述向量化與 Cypher 混合圖譜向量搜尋，提取並去重關聯關係人與法條。

## 3. Local UI Prototype

- [x] 3.1 實作基於 Gradio 的互動式本地網頁檢索介面 `scripts/search_ui.py`，支援輸入描述與選取法院/案件類別過濾，並渲染檢索結果。

---

## Verification

### vector-ingestion
1. **執行向量更新**：
   ```bash
   .venv\Scripts\python scripts/update_embeddings.py --limit 100
   ```
2. **驗證向量索引狀態**：
   在 Neo4j 中執行 `SHOW INDEXES YIELD name, type, state` 確認 `section_embedding_index` 為 `ONLINE`。

### hybrid-retrieval-pipeline
1. **執行本地管道測試**：
   ```bash
   .venv\Scripts\python -c "from scripts.search_pipeline import search_similar_judgments; import pprint; pprint.pprint(search_similar_judgments('被告騎腳踏車闖紅燈，撞倒行人致使骨折後逃逸', limit=2))"
   ```

### search-local-ui
1. **啟動 Gradio 本地網頁 UI**：
   ```bash
   .venv\Scripts\python scripts/search_ui.py
   ```
2. **手動測試網頁互動**：
   於瀏覽器中輸入犯罪描述與條件，驗證相似判決與引用法規是否正確渲染。
