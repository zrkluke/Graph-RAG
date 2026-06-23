## 1. 本地 Leiden 社群偵測實作

- [x] 1.1 安裝 Python 依賴：在 Python 環境中安裝 `python-igraph`, `leidenalg` 等函式庫。
- [x] 1.2 撰寫 Python 偵測腳本：建立 `scripts/community_detection.py`，支援連線 Neo4j，撈取 Judgment 節點與其共享 Law 的關係，建立 igraph 對象。
- [x] 1.3 實作演算法與 Fallback：在腳本中調用 Leiden 演算法計算社群，並加入 Fallback 至 Louvain (igraph `community_multilevel`) 的容錯機制。
- [x] 1.4 批次寫回資料庫：使用 `UNWIND` 批次 Cypher 指令，將社群整數 ID 寫回 Neo4j `Judgment` 節點的 `community` 屬性中，並在終端機輸出分佈統計。

## 2. 後端 API 與檢索重構 (RRF & Recommendation)

- [x] 2.1 全文檢索與向量檢索實作：修改 `frontend/src/app/api/search/route.ts`，分別實作基於 `judgment_text_index` 的全文檢索與基於 `section_embedding_index` 的向量檢索。
- [x] 2.2 相似案例推薦 Cypher 圖遍歷：在查詢中整合 `OPTIONAL MATCH` 圖遍歷，撈取與該 Judgment 共享最多引用 Law 的前 3 筆 Judgment（包含代碼、案由、法院與共享法條數）。
- [x] 2.3 RRF 混合排序與並行執行：在 `route.ts` 中，使用 `Promise.all` 並行執行三種檢索（關鍵字、向量、混合 RRF），在記憶體中執行 RRF 分數計算，並使用 `performance.now()` 精確統計各演算法的 Response Time (ms)。
- [x] 2.4 API 回傳格式適配：確保 `/api/search` 返回 `{ keyword: { results, responseTimeMs }, vector: { results, responseTimeMs }, hybrid: { results, responseTimeMs } }` 的格式。

## 3. 前端 UI 佈局與 Accordion 升級

- [x] 3.1 升級摺疊面板 (Accordion) 狀態控制：在 `frontend/src/app/page.tsx` 中，將 `activeIndex` 修改為 `expandedIds` (Set 或 Record) 以支援同時多開。
- [x] 3.2 渲染相似案例推薦列表：在 Accordion 卡片展開內容的底部，渲染該判決的「相似案例推薦」列表，點擊推薦項目可直接定位或展示該判決的詳情。
- [x] 3.3 重構搜尋結果為三欄式對照佈局：修改 `page.tsx` 的搜尋結果渲染，設計三個並排水平欄位展示三種演算法，並在頂部醒目展示 `⚡ Response Time`。
- [x] 3.4 前端圖譜社群著色：修改 `frontend/src/components/GraphNetwork.tsx`，根據節點的 `community` 屬性值，為 Vis.js 節點動態分配不同的色系（如社群 0 為藍色，社群 1 為綠色等），以達成圖譜社群視覺化。

## 4. 系統驗證與測試

- [x] 4.1 本地社群計算驗證：執行 `python scripts/community_detection.py`，確認 Neo4j 資料庫成功寫入 `community` 屬性。
- [x] 4.2 API 效能與數據檢驗：透過 API 測試腳本或 Postman 呼叫 `/api/search`，驗證返回結構正確且包含 `responseTimeMs` 與 `similarRecommendations`。
- [x] 4.3 UI 整合手動測試：在瀏覽器中操作搜尋，確認三欄式佈局美觀、多項目展開順暢、推薦卡片連結有效，且 Graph 畫布中節點顏色呈社群分佈。
