## ADDED Requirements

### Requirement: 後端 API 支援三種檢索演算法對比
Next.js 後端 API 端點 `/api/search` 必須支援三種不同的搜尋模式（全文關鍵字、純向量、混合 RRF），並在單次請求中或透過並行請求返回這三種模式各自的查詢結果、回傳數據以及獨立的 Response Time (ms)。

#### Scenario: 搜尋 API 成功返回三種演算法的對比數據
- **WHEN** 發送 HTTP GET 請求至 `/api/search`，帶有查詢參數 `q`
- **THEN** API 應在 200 回應中返回一個 JSON 物件，其中包含三個欄位：`keyword`、`vector` 與 `hybrid`，且每個欄位皆應包含：
  1. `results`: 搜尋到的判決書陣列（排序後的前 N 筆）
  2. `responseTimeMs`: 該演算法的執行毫秒數
  3. `debugInfo`: 用於追蹤檢索內部權重的除錯資訊

### Requirement: 前端三欄式演算法對比 UI
前端首頁應採用並排的三欄式佈局，讓使用者能直觀對比三種搜尋演算法的排序與內容差異，並在各欄頂部顯著展示該演算法的 Response Time。

#### Scenario: 渲染三欄式並排的搜尋結果與耗時
- **WHEN** 使用者輸入搜尋關鍵字並送出，且 API 回傳三種演算法數據
- **THEN** 頁面應水平並排渲染三欄，由左至右分別為「全文檢索 + 圖遍歷」、「向量檢索 + 圖遍歷」與「混合檢索 (RRF) + 圖遍歷」，且在各欄頂部標示如 `⚡ 45 ms` 的回應耗時。
