## Why

目前專案已成功在雲端 Neo4j AuraDB 匯入了 10,000 筆結構化法律判決書資料，並將其切分為細粒度的 Section 段落。
為實現「自然語言情境描述」的智慧檢索，系統需要引進語意向量檢索能力，將使用者輸入之犯罪情境與判決書事實段落進行語意比對。本變更旨在建立向量資料的補全流程、設計 Neo4j 向量檢索索引，並開發本地的混合搜尋演算法與原型檢索介面。

## What Changes

- **新增向量更新工具**：建立 `scripts/update_embeddings.py`，用於批次對資料庫中的 `Section` 節點調用 OpenAI Embedding API（`text-embedding-3-small`，1536維）生成並寫入 `embedding` 屬性。
- **建立向量索引**：於 Neo4j 中建立 `section_embedding_index`。
- **開發混合檢索管道**：建立 `scripts/search_pipeline.py`，實現以情境描述向量化為基礎，結合 Neo4j 向量搜尋、篩選條件（法院層級、案件類別）與圖譜擴展（關聯法條統計）的檢索邏輯，直接回傳排序與過濾後的判決書列表（不涉及 LLM 文本生成）。
- **建立本地原型介面**：利用 Gradio/Streamlit 或簡單的 Python Web 框架於 `scripts/search_ui.py` 實作一個本地互動式搜尋介面，供使用者玩玩看。

## Capabilities

### New Capabilities
- `vector-ingestion`: 實作 Section 節點的向量化與寫回資料庫，以及 Neo4j 向量索引建立。
- `hybrid-retrieval-pipeline`: 實作結合向量與圖譜關係的混合檢索演算法。
- `search-local-ui`: 實作本地 Python 互動式檢索原型介面。

### Modified Capabilities
（無變更現有能力需求）

## Impact
- **依賴套件**：新增 `openai` (用於調用 Embedding API)、以及本地介面所需的套件（如 `gradio` 或 `streamlit`）。
- **資料庫變更**：`Section` 節點新增 `embedding` 屬性（1536維實數陣列），並新增一個 Vector 索引 `section_embedding_index`。
