## 1. 專案初始化與套件配置

- [x] 1.1 使用 npx 初始化 Next.js (TypeScript/Tailwind/App Router) 專案於根目錄 of `frontend/` 目錄下
- [x] 1.2 於 Next.js 專案內安裝官方 `neo4j-driver`、`openai` 及 `vis-network` 與對應的 @types 套件
- [x] 1.3 建立 `frontend/.env.local` 檔案配置本地測試的資料庫與 API 環境變數，並更新根目錄 `.gitignore`

## 2. 後端 API 實作

- [x] 2.1 實作 `/api/search/route.ts` API，對接 OpenAI embedding `text-embedding-3-small` 模型
- [x] 2.2 實作並快取 Neo4j 驅動（防止 Serverless 連線溢出），執行與 Python 原型完全相同的混合 Cypher 檢索
- [x] 2.3 實作返回結果之格式化處理（如過濾當事人雜訊、去重統計），並處理例外異常

## 3. 前端 UI 與圖譜視覺化實作

- [x] 3.1 實作 React 前端首頁佈局，包含案情描述 TextArea、過濾 Dropdown 及筆數 Slider 側邊欄
- [x] 3.2 實作首頁頂部 Dashboard，動態統計並呈現相似判決中出現次數最高的前三名法條
- [x] 3.3 實作 `GraphNetwork.tsx` 客戶端圖譜渲染組件，使用 `vis-network` 將搜尋結果動態渲染為互動網狀 Canvas
- [x] 3.4 實作雙 Tabs 介面切換（「相似判決卡片」與「關聯圖譜網絡」）

## 4. 本地驗證與 Vercel 部署準備

- [x] 4.1 於本地啟動 Next.js 開發伺服器，並以瀏覽器執行模糊案情檢索，進行功能與排版驗證
- [x] 4.2 驗證卡片列表渲染、頂部 Dashboard 統計、及圖譜 Canvas 拖曳、縮放與 hover tooltip 功能
- [x] 4.3 執行 `npm run build` 編譯驗證，確保無 TypeScript / Linter 錯誤
