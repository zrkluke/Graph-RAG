## 1. 斷落切分與實體資料庫匯入 (ETL & Ingestion)

- [x] 1.1 在 [judgment_splitter.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/judgment_splitter.py) 中新增中文遞迴字元切分器 `split_text_into_chunks(text, chunk_size=1000, overlap=150)`。
- [x] 1.2 修改 [judgment_splitter.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/judgment_splitter.py) 中 `split_judgment_into_sections` 的回傳結構，包含各段落切分後的複數個 Chunks 資訊。
- [x] 1.3 在 [import_judgments.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/import_judgments.py) 的 `init_db` 中新增 `Chunk` 節點 id 的 Unique Constraint。
- [x] 1.4 修改 [import_judgments.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/import_judgments.py) 中的 Neo4j 寫入 Cypher `write_to_neo4j`。建立 `Chunk` 節點及 `(s:Section)-[:HAS_CHUNK]->(c:Chunk)` 關係。
- [x] 1.5 修改 [import_judgments.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/import_judgments.py) 中的資料處理流程，將切分出來的 Chunks 批次傳遞至寫入函數中並執行。

## 2. 向量生成與索引重建 (Embedding & Indexing)

- [x] 2.1 修改 [update_embeddings.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/update_embeddings.py) 中的 `init_vector_index`，建立針對 `Chunk` 節點的向量索引 `chunk_embedding_index`（維度 1536，cosine 相似度）。
- [x] 2.2 修改 [update_embeddings.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/update_embeddings.py) 中的掃描與查詢 Cypher，改為掃描尚未有 embedding 的 `Chunk` 節點而非 `Section`。
- [x] 2.3 修改 [update_embeddings.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/update_embeddings.py) 中的 OpenAI batch 呼叫與寫回資料邏輯，將生成的 embedding 寫回 `Chunk` 節點。

## 3. 搜尋管道與上下文重組 (Search Pipeline & API)

- [x] 3.1 修改 [search_pipeline.py](file:///c:/PythonSideProjects/%E5%88%A4%E6%B1%BA%E6%9B%B8%E6%90%9C%E5%B0%8B%E7%B3%BB%E7%B5%B1/scripts/search_pipeline.py) 的向量檢索 Cypher，改用 `chunk_embedding_index` 檢索 `Chunk` 節點。
- [x] 3.2 調整檢索 Cypher：使用向量搜尋取得 top-k 的 Chunk 節點，並透過關係 `(Section)-[:HAS_CHUNK]->(Chunk)` 向上還原大段落（`s.text`）作為上下文，避免 overlap 重複字句。
- [x] 3.3 修改 Next.js 中後端 API 路由與 Cypher 的對應實作，確保其能正確連接與處理新 Schema。

## 4. 驗證與測試 (Verification & Testing)

- [x] 4.1 執行 `import_judgments.py --limit 5` 匯入測試樣本，並在 Neo4j 瀏覽器中驗證 `Chunk` 節點與關係是否正確建立。
- [x] 4.2 執行 `update_embeddings.py` 進行向量補全，確認所有 Chunk 的 embedding 寫入正常。
- [x] 4.3 執行檢索測試，驗證搜尋結果能成功返回且 LLM 生成上下文正常還原。
