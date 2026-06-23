## Context

目前系統僅支援基於 Section 向量的檢索，且前端展示受限於單一展開的 Accordion 折疊面板。為了讓使用者能直觀對照全文檢索、純向量檢索與混合檢索 (RRF) 的成效，並呈現 Response Time 效能對比，本設計方案將重構搜尋 API 與前端 UI。

此外，為加強 Graph RAG 的結構化社群聚類分析，本方案將設計本地 Python 腳本來執行 Leiden 社群偵測演算法，將聚類結果回寫至資料庫中，並在前端圖譜中以不同顏色視覺化呈現社群分群；同時透過圖遍歷實作「與本案法律適用最相似的案例」推薦功能。

## Goals / Non-Goals

**Goals:**
- 提供全文檢索、向量檢索、混合檢索 (RRF) 三種搜尋演算法的並行查詢及耗時測量。
- 前端 UI 改為三欄式對照佈局，展示三種演算法的檢索結果與 Response Time。
- 升級 Accordion UI，允許同時展開多個判決書條目。
- 在 Accordion 展開卡片底部，顯示基於圖遍歷（共享引用法條）的前 3 筆相似案例推薦。
- 提供本地 Python 腳本，透過 Leiden 演算法對 Judgments 進行社群分群並回寫至 Neo4j，並在前端 `GraphNetwork` 中依社群給予節點不同顏色以達成視覺化分群。

**Non-Goals:**
- 不涉及共犯網絡追蹤功能（未來功能，暫不開發）。
- 不在 Next.js 後端執行大規模的線上 Leiden 計算（Leiden 計算採離線 Python 執行並回寫）。

## Decisions

### 1. Leiden 社群偵測的圖結構定義與演算法選擇
- **決策**：在 Python 腳本中，以 `Judgment` 為節點，並以「兩個判決書共享相同的 Law 節點」作為邊。邊的權重等於共享 Law 的數量。若共享數量大於等於 1 則建立邊。
- **理由**：共享法條數反映了案件在法律適用上的相似度，基於此關係產生的社群代表「法律適用高度相近的案件聚類」，最具法律參考價值。
- **替代方案**：使用 `SIMILAR_TO`（向量相似度）作為邊。但向量相似度常受事實描述文字（如車牌、人名、路名）的干擾，法律適用的社群界線不如共享法條明確。

### 2. 混合檢索 (RRF) 與 Reranking 在後端 Node.js 執行
- **決策**：不使用 Neo4j 的 APOC 函數來計算 RRF，而是使用 Neo4j Driver 在 Node.js 後端並行發起「全文關鍵字檢索」與「純向量檢索」，並在 Node.js 記憶體中執行 RRF 計算及合併。
- **理由**：
  1. 避免對 APOC 的依賴，提高對不同 Neo4j 版本/環境（如 AuraDB Free 限制）的相容性。
  2. 在 Node.js 內計算方便調整常數 $k$ (預設為 60) 與除錯，且並行查詢的效能優異。
  3. 全文檢索與向量檢索在撈取時已將關聯的實體（法官、被告、法條）一併查出，在記憶體中合併後直接回傳，減少二次查詢。

### 3. 圖遍歷相似案例推薦整合於搜尋 API 一併回傳
- **決策**：在 `/api/search` 查詢 Judgments 時，直接在 Cypher 中利用 `OPTIONAL MATCH` 與 `collect` 圖遍歷查出與該 Judgment 共享最多 Law 的前 3 筆相似 Judgment，並隨搜尋結果回傳。
- **理由**：相較於「點擊展開時再發送 API 請求」，在一次 Cypher 查詢中完成圖遍歷幾乎不增加額外耗時，但能大幅簡化前端狀態管理，並提升 UI 展開的響應速度。

### 4. 前端 Accordion 與欄位狀態管理
- **決策**：前端使用 `Set` 物件或 `Record<string, boolean>` 來儲存各個卡片的展開狀態。
- **理由**：這使得多個卡片可以獨立控制開關，實現多項目同時展開的功能。

### 5. 前端圖譜 (GraphNetwork) 的社群著色
- **決策**：在前端接收到 Graph 節點時，根據節點的 `community` 屬性（若有），將節點的顏色屬性（Vis.js 中的 `color`）設為該社群預設的顏色。
- **理由**：能顯著提升圖譜的視覺吸引力 (Rich Aesthetics)，讓使用者直觀感受到 Graph RAG 的社群分群成果。

## Risks / Trade-offs

- **[Risk] Leiden 依賴庫安裝問題** → `leidenalg` 需要 C 語言編譯環境，在某些 Windows 環境下 `pip install` 可能會失敗。
  - **Mitigation**：在 Python 腳本中，優先嘗試導入 `leidenalg`。若導入失敗，則提供備用方案：使用 `python-igraph` 內建的 `community_multilevel` (Louvain 演算法) 作為 fallback，以確保腳本可以在任何無 C 編譯器的環境下正常運作。
- **[Risk] 連線限制與 AuraDB 負載** → 並行發送多個查詢可能導致連線數暴增。
  - **Mitigation**：Next.js 已使用 `globalThis.neo4jDriver` 快取 Driver。查詢會使用 Session 叢集，並妥善在 `finally` 區塊中 `session.close()` 釋放連線。
