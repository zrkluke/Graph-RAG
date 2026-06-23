# Design: Python 重構 TypeScript 設計說明 (refactor-python-to-typescript)

## 1. 架構調整與路徑對照
所有腳本均搬移至 `frontend/src/scripts/`，移除舊有 `scripts/`：

| Python 腳本 (舊) | TypeScript 腳本 (新) | 功能描述 |
| :--- | :--- | :--- |
| `court_mapping.py` | `court_mapping.ts` | 法院別名、層級對照配置表 |
| `court_parser.py` | `court_parser.ts` | 解析法庭資料夾名稱之地區與類別 |
| `law_names.py` | `law_names.ts` | 中華民國現行法規白名單與同義詞對照 |
| `statute_parser.py` | `statute_parser.ts` | 狀態機正則法條引用提取模組 |
| `text_cleaner.py` | `text_cleaner.ts` | 文本清洗、斷行壓縮、頁尾刪除 |
| `judgment_splitter.py` | `judgment_splitter.ts` | 段落 (Section) 與分塊 (Chunk) 切分器 |
| `import_judgments.py` | `import_judgments.ts` | 主資料匯入腳本 (Neo4j Transaction 批次寫入) |
| `import_sample.py` | `import_sample.ts` | 隨機比例抽取測試資料匯入腳本 (控制 Promise 並行度) |
| `community_detection.py` | `community_detection.ts` | 純 TS 記憶體內標籤傳播演算法 (LPA) |
| `update_embeddings.py` | `update_embeddings.ts` | 調用 OpenAI Embedding API 更新向量值 |
| `verify_db.py` | `verify_db.ts` | 資料庫節點、關係與索引健康度檢查 |
| `test_neo4j_connection.py` | `test_neo4j_connection.ts` | 資料庫連線檢測工具 |
| `search_pipeline.py` | `search_pipeline.ts` | 命令行 Hybrid Search 檢索工具 |

## 2. 核心模組設計說明

### 2.1 法規引用提取 (`statute_parser.ts`)
* **設計變更**：將原 Python 逐字走訪的狀態機模型重寫為 **JavaScript 複合正規表示式狀態機**。
* **邏輯**：
  1. 利用法規白名單識別法規主體（如 "中華民國刑法"、"道路交通安全規則"）。
  2. 使用狀態標記跟蹤後續的 "第幾條"、"第幾項"、"第幾款"、"第幾目"。
  3. 對於 `同法`、`同條`、`前條` 進行上下文狀態記錄與指代詞補全，以精準鏈結實體。

### 2.2 純 TS 標籤傳播演算法 (LPA) (`community_detection.ts`)
* **設計變更**：為了繞過 Neo4j AuraDB Free 不支援 GDS 插件的限制，改用純 TS 在本地記憶體實作 LPA 圖聚類。
* **邏輯**：
  1. 連線 Neo4j，利用 Cypher 查詢拉取所有的 `Judgment` 節點，以及基於向量相似度形成的 `SIMILAR_TO` 關係網。
  2. 在本地記憶體中建構鄰接表 (Adjacency list)。
  3. 初始化：每個節點擁有其獨立的社群 Label（通常設為其節點 ID）。
  4. 迭代傳播：在每輪迭代中，節點會更新其 Label 為其鄰居節點中最頻繁出現的 Label。
  5. 收斂或達到最大迭代次數 (預設 20 次) 後，使用 Neo4j 批次更新，將結果寫回 `Judgment.community` 屬性。

## 3. 環境與執行期設計
* **運行引擎**：採用 `tsx` (TypeScript Execute) 作為執行期，避免手動執行 `tsc` 編譯為 JS 的繁瑣步驟，可直接執行 `.ts` 檔案。
* **環境變數載入**：在所有入口腳本（Entrypoints）中，同時調用對根目錄 `.env.local` 以及前端目錄 `frontend/.env.local` 的讀取，確保不論在哪個目錄下調用，皆能正確認證。
