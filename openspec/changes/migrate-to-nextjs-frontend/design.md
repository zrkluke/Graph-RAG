## Context

目前專案已實作 Python 混合檢索演算法與基於 Gradio 的本地網頁 UI。為了在不產生伺服器租用成本（如 AWS EC2 或 Heroku）的情況下部署至雲端，我們採用「Vercel + Next.js App Router (TypeScript)」的無伺服器 (Serverless) 架構。Next.js 的後端 API 路由將直接調用 OpenAI 與 Neo4j AuraDB 雲端服務，前端則使用 React 來重現 Gradio 的卡片呈現與動態關係圖。

## Goals / Non-Goals

**Goals:**
- 在根目錄下建立獨立的 `frontend/` 資料夾，封裝 Next.js (14+) 前後端代碼。
- 100% 移植 Python `search_pipeline.py` 的 Cypher 檢索演算法至 Next.js Route Handler。
- 使用開源 `vis-network` (JS 版本) 在前端 Canvas 渲染互動式關係圖譜，提供流暢的縮放與拖曳體驗。
- 提供 Top 3 核心法條統計儀表板，支援法院層級與案件種類過濾。
- 支援一鍵部署至 Vercel 平台，實現零伺服器費用託管。

**Non-Goals:**
- 不移植 Python 的資料清洗、實體 NER 擷取與抽樣寫入腳本（維持 Python 在本地執行資料匯入）。
- 不涉及大語言模型 (LLM) 生成綜合報告（僅回傳相似判決書與圖譜關聯）。

## Decisions

- **選擇 Next.js Serverless Route Handler 作為 API 後端**：
  - *原因*：使用 `neo4j-driver` 與 `openai` 官方 npm 套件直接在 Node.js Serverless Function 中呼叫，可免除建置 Python FastAPI 後端服務的成本，由 Vercel 免費託管。
  - *替代方案*：架設獨立 Python FastAPI 後端。缺點是需要額外費用託管（如租用機器或第三方 PaaS）。
- **使用原生 `vis-network` JavaScript 庫**：
  - *原因*：Python `pyvis` 本質上就是對 `vis-network` 的 Python 封裝。直接使用 `vis-network` 可以保證節點與邊的 JSON 數據結構 1:1 相容，移植成本最低，且 Canvas 性能極佳。
  - *替代方案*：`react-force-graph` 或 `d3.js`。雖然高度可客製化，但學習曲線較陡且資料結構需要大量重組。
- **後端實作全域驅動快取 (Global Driver Cache)**：
  - *原因*：Serverless Function 會頻繁地建立與銷毀。為了防止每次 API 呼叫都重新建立 Neo4j Driver 連線而導致 AuraDB Free 的連線數溢出，我們必須在 Node.js 的全域變數中快取 `driver` 實例。

## Risks / Trade-offs

- **[風險] Serverless 每次冷啟動連線資料庫超時**
  - *緩解措施*：透過全域變數 `global.neo4jDriver` 進行驅動快取。此外，OpenAI Embedding 與 Neo4j 混合查詢在 AuraDB Free 上的平均響應時間約為 1-2 秒，遠低於 Vercel Serverless Function 最低 10 秒的限制。
- **[風險] 免費版 AuraDB 頻繁查詢的 TPM Rate Limit**
  - *緩解措施*：在前端加入簡單的防抖 (Debounce) 機制，避免使用者快速點擊按鈕重複發送查詢。
