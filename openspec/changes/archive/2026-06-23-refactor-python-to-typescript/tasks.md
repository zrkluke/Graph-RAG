# Tasks: Python 重構 TypeScript 任務狀態 (refactor-python-to-typescript)

## 1. 初始化與環境配置
* [x] 在根目錄配置代理指令的 `package.json`
* [x] 更新 `frontend/package.json` 新增 `tsx` 與 `dotenv`
* [x] 執行 `npm install` 補齊依賴套件

## 2. 移除 Python 舊有檔案
* [x] 刪除 `requirements-key-packages.txt`
* [x] 刪除 `tutorial/` 資料夾
* [x] 刪除原根目錄下的 `scripts/`（Python 檔案）

## 3. 實作 TypeScript 核心模組
* [x] 實作 `court_mapping.ts` 法院映射配置
* [x] 實作 `court_parser.ts` 地理別與案類解析
* [x] 實作 `law_names.ts` 現行法規對照表
* [x] 實作 `statute_parser.ts` 狀態機正則法條提取器
* [x] 實作 `text_cleaner.ts` 文本清洗器
* [x] 實作 `judgment_splitter.ts` 判決書 Section/Chunk 切分器
* [x] 實作 `import_judgments.ts` 資料批次導入腳本
* [x] 實作 `import_sample.ts` 資料抽樣導入與並行度控制
* [x] 實作 `community_detection.ts` 純 TS 版標籤傳播演算法 (LPA)
* [x] 實作 `update_embeddings.ts` OpenAI 向量生成與回寫
* [x] 實作 `verify_db.ts` 資料庫健康度與統計驗證腳本
* [x] 實作 `test_neo4j_connection.ts` 資料庫連線測試腳本
* [x] 實作 `search_pipeline.ts` 命令行混合搜尋檢索管線

## 4. 驗證與編譯診斷
* [x] 修正 `community_detection.ts` 與 `import_judgments.ts` 的 TypeScript 類型問題
* [x] 執行 TypeScript 靜態編譯診斷，確認 0 compilation errors 狀態
* [x] 修改並更新專案根目錄繁中 `README.md` 的快速啟動指引
* [x] 將此 TS 重構規格更新回 `openspec/project.md` 專案說明書
