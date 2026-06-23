## Why

目前系統僅提供單一的向量檢索模式，使用者無法直觀對比不同檢索演算法（如全文檢索、純向量檢索、混合檢索）的檢索品質與效能。此外，前端 UI 的折疊面板（Accordion）僅支援單一展開，且缺乏類似案例推薦與社群分群視覺化等進階 Graph RAG 特性，限制了本系統在法律實務上的應用價值。

## What Changes

- **新增** 本地 Python 離線社群偵測腳本，使用 Leiden 演算法對判決書進行聚類分群，並回寫社群標籤至 Neo4j 節點中。
- **修改** Next.js `/api/search` 後端 API，整合三種搜尋策略（全文、向量、混合 RRF）的並行查詢、回傳 Response Time 耗時，並透過圖遍歷計算相似案例。
- **修改** 前端 UI 為三欄式演算法對照佈局，展示三種不同搜尋演算法的結果、耗時與排序差異。
- **修改** 前端結果卡片，支援同時展開多個項目的 Accordion 效果。
- **新增** 在 Accordion 展開卡片底部，展示基於純圖遍歷（共享引用法條）推薦的前 3 筆相似案例。

## Capabilities

### New Capabilities

- `community-detection`: 本地運行 Python 腳本，透過 Leiden 演算法對判決書共享法條關係進行社群劃分，並將 `community` 屬性回寫至 Neo4j `Judgment` 節點。
- `multi-algorithm-comparison`: 在後端 API 與前端 UI 同時提供「全文關鍵字搜尋 + 圖遍歷」、「向量搜尋 + 圖遍歷」與「混合搜尋 (RRF) + 圖遍歷」三種搜尋演算法的結果對比，並回傳與展示各演算法之 Response Time。
- `similar-judgment-recommendation`: 利用 Cypher 純圖遍歷（共享最多引用法規之 Judgment 節點）於前端 Accordion 展開之判決卡片底部推薦前 3 筆最相似判決。
- `accordion-ui-enhancement`: 升級前端 UI 的 Accordion 折疊面板，允許使用者同時展開多個判決書詳情。

### Modified Capabilities

<!-- 空 -->

## Impact

- **Python 環境**：需要安裝額外的社群偵測依賴（如 `igraph`, `leidenalg` 等）。
- **Neo4j 資料庫**：`Judgment` 節點將新增 `community` 屬性。
- **後端 API**：`/api/search` 需要更新，以支援混合查詢（RRF 合併）、耗時測量與圖遍歷相似案例查詢。
- **前端頁面**：`frontend/src/app/page.tsx` 將進行版面重構，以支援三欄式比較與改良版 Accordion 元件。
