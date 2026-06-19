## Why

目前法律判決書 Graph RAG 搜尋系統是透過 Python 與 Gradio 架設本地的原型 UI。為了完成「最低成本」與「完全免費」的部署計畫，我們需要將整個系統遷移到 Next.js 框架。Next.js 的 Serverless Route Handlers 可以直接部署在 Vercel 平台上，完全免除租用獨立 Python 伺服器的託管費用，同時 React 能夠提供更加流暢、客製化的前端 UI 體驗，為未來系統正式上線做好準備。

## What Changes

- **新增 Next.js 全棧專案**：在專案根目錄下新建 `frontend/` 資料夾，使用 TypeScript、TailwindCSS 與 App Router。
- **移植混合檢索後端**：將原先 Python `search_pipeline.py` 的 Cypher 檢索與 OpenAI Embedding 邏輯移植至 Next.js Route Handler (`/api/search`)，使用 `neo4j-driver` 與 `openai` npm 套件。
- **重建前端使用者介面**：使用 React 重新實作包含情境搜尋、法院層級與案件種類過濾的 UI。
- **動態圖譜視覺化移植**：在 React 端直接使用 `vis-network` (JavaScript 版本的網絡圖套件) 代替 Python 的 `pyvis`，直接在前端瀏覽器端渲染 HTML5 Canvas 互動圖譜，改善互動流暢度。

## Capabilities

### New Capabilities

- `nextjs-serverless-search`: 實作 Next.js 後端 Serverless Route Handler，提供 `/api/search` API 接收案情描述向量化並連線 Neo4j AuraDB 進行 Cypher 混合檢索。
- `react-interactive-graph-ui`: 實作 React 前端互動式搜尋頁面與 Top 3 核心法條統計儀表板，並集成網頁端 `vis-network` 提供節點拖曳、無級縮放與 hover 提示的動態關係圖。

### Modified Capabilities

*(無)*

## Impact

- **新增目錄**：新增根目錄下的 `frontend/`，包含 Next.js 的完整專案與依賴管理 (`package.json`)。
- **新增依賴**：引入 npm 套件 `neo4j-driver`, `openai`, `vis-network`。
- **部署平台變更**：使用 Vercel 作為雲端主機，取代本地 Gradio UI，環境變數配置於 Vercel Dashboard 中。
