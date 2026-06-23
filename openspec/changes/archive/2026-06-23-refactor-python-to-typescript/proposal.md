# Proposal: 將數據導入與分析腳本全面自 Python 重構至 TypeScript (refactor-python-to-typescript)

## 1. 摘要 (Summary)
本提案建議將專案根目錄下原有的 Python 腳本（用於資料清洗、段落切分、資料庫寫入、圖譜社群偵測等）全面重構為 TypeScript，並將其整合至前端目錄中（`frontend/src/scripts/`），以達到單一開發語言棧（TypeScript）、簡化部署流程、免除 Python 本地環境與編譯依賴的目標。

## 2. 動機與背景 (Motivation & Background)
本專案先前採用 Python 作為後台 ETL/Ingestion 腳本（位於根目錄 `scripts/`），前端則採用 Next.js。這種「雙語言」設計在部署與維護上面臨以下痛點：
* **Vercel 部署路徑限制**：Vercel 部署 Serverless API 時，無法在構建階段打包並引用根目錄外部的 `../scripts/` 目錄。為了使未來的後端 API 能夠無縫調用資料清洗與解析函數，所有代碼必須收納至 `frontend/` 目錄中。
* **原生套件編譯衝突 (Windows)**：原 Python 社群偵測腳本依賴 `igraph` 圖論庫。在 Windows 開發環境中，`igraph` 的 C++ 編譯器常會引發嚴重的相容性問題與安裝錯誤。
* **AuraDB Free 限制**：雲端免費版 Neo4j AuraDB 不支援 GDS (Graph Data Science) 圖演算法外掛，使得原生的 GDS LPA（標籤傳播演算法）無法使用。
* **環境依賴複雜**：開發者需要同時維護 Python venv/Pipenv 與 Node.js npm 兩套環境，增加了協同開發的門檻。

## 3. 解決方案 (Proposed Solution)
* **單一語言整合**：全面廢除 Python 環境與 Python 腳本，將資料處理腳本全面移植為 TypeScript，統一放置於 `frontend/src/scripts/` 下。
* **純 TypeScript LPA 實作**：在 `community_detection.ts` 中，手動使用 TypeScript 實作標籤傳播演算法 (Label Propagation Algorithm)，在記憶體中處理圖的聚類分析，避開對 Python `igraph` 與 Neo4j GDS 的依賴。
* **指令代理化**：在根目錄新增 `package.json` 指令代理，透過 `npm run db:... --prefix frontend` 代理由前端處理的所有資料庫 CLI 任務，保持根目錄操作習慣。

## 4. 影響評估 (Impact)
* **優點**：
  * **簡化開發**：全棧統一使用 TypeScript / Node.js 執行，免除 Python 本地配置。
  * **Vercel 相容**：所有解析與切分模組（如 `statute_parser`、`text_cleaner`）均放置在前端目錄中，可直接在 Next.js Serverless Function 中引用。
  * **安裝無障礙**：純 TS 程式碼無 C++ 原生編譯依賴，Windows、Mac、Linux 均可一鍵安裝。
* **缺點**：
  * 需要花費時間將 Python 狀態機代碼與正規表示式完全重寫為 JS 規格。
