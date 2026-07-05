# 法律判決書 Graph RAG 搜尋系統 — AI Agent 開發指引 (AGENTS.md)

本文件專為協助本專案的 AI 編碼助手（如 Cursor, Claude 等）所撰寫。當您在此專案中進行後續開發、規格編寫或程式碼修改時，請嚴格遵循以下設定的世界觀、系統架構與部署策略。

---

## 1. 專案世界觀與目標

### 1.1 目標
建構一個 **智慧型法律判決書搜尋與圖譜分析系統**：
1. **資料處理**：從司法院 OpenData 擷取判決書文本，利用命名實體識別 (NER) 與關聯抽取，將判決書中的重要實體（如被告、原告、法官、引用法條、罪名等）擷取出來，以知識圖譜的形式寫入 Neo4j。
2. **語義與篩選搜尋**：使用者輸入一段「自然語言情境描述」（例如：「被告酒後騎車撞傷行人並逃逸」），系統將進行語義相似度比對，結合圖譜關聯進行檢索，由高到低排序最相似的判決書。同時支援以「法院層級」（最高法院、高等法院、地方法院）等多重條件進行篩選。

### 1.2 技術限制與省錢策略（Free Tier 部署計畫）
為達成「最低成本」甚至「完全免費」的部署需求，我們採用以下省錢且高效的雲端架構：

1. **圖資料庫 (Database)**: 
   * **Neo4j AuraDB Free**（官方雲端託管免費版）：提供 1 個免費圖資料庫實例（支援最多 200,000 個節點與 400,000 條關係），完全免信用卡、免維護費，效能優異，極適合開發與中小型應用。
2. **Web 應用程式與 API (Backend & Frontend)**:
   * **Vercel (Next.js)**：使用 Next.js 進行全棧式開發。
   * **優勢**：Vercel 的免費額度非常慷慨，且支援 **Serverless Route Handlers**（路由處理器）。我們可以直接在 Next.js 的 API 路由中使用 TypeScript/JavaScript 的 `neo4j-driver` 與 `langchain` 直接連接 Neo4j AuraDB，**完全不需要另外花錢租用獨立的 Python FastAPI 後端伺服器**，從而實現 **0 元部署**！
3. **LLM 與 Embedding API**:
   * 使用 OpenAI API 或其他相容的免費/低成本 LLM 服務。
4. **Redis 快取層 (Cache)**:
   * **Upstash Redis** (免費版)：提供雲端 Redis 快取。在 Next.js API 路由中配置 Redis，以查詢參數 MD5 雜湊值為 Key，緩存搜尋結果（TTL 3 天），大幅降低 OpenAI Embedding 的 Token 消耗與 Neo4j 的查詢壓力。

---

## 2. 系統架構設計

```
              ┌────────────────────────────────────────────────────────┐
              │                     Vercel 雲端平台                     │
              │                                                        │
              │  ┌─────────────────┐                                   │
              │  │  Next.js 前端   │                                   │
              │  │  (React UI)     │                                   │
              │  └────────┬────────┘                                   │
              │           │ (HTTP)                                     │
              │           ▼                                            │
              │  ┌─────────────────┐    ┌─────────────┐  ┌──────────┐  │
              │  │ Next.js API 路由│───▶│ OpenAI API  │  │ Upstash  │  │
              │  │ (Serverless API)│    │ (Embedding) │  │  Redis   │  │
              │  └────────┬────────┘    └─────────────┘  └────┬─────┘  │
              └───────────┼───────────────────────────────────┼────────┘
                          │ (Bolt over TLS)                   │ (Cache Hit/Miss)
                          ▼                                   ▼
              ┌────────────────────────────────────────────────────────┐
              │                   Neo4j AuraDB Free                    │
              │                                                        │
              │  • Document (判決書)                                   │
              │  • Entity (被告/法官/法條)                             │
              │  • Vector Index (向量搜尋)                              │
              └────────────────────────────────────────────────────────┘
```

---

## 3. 圖譜資料模型設計 (Neo4j Schema)

### 3.1 節點類型 (Node Labels)
1. **`Judgment` (判決書)**:
   * `id`: `String` (判決字號/系統ID)
   * `court`: `String` (法院名稱，如：臺灣台北地方法院、最高法院)
   * `court_level`: `String` (法院層級，如：地方法院、高等法院、最高法院)
   * `date`: `Date` (判決日期)
   * `reason`: `String` (案由)
   * `main_text`: `String` (主文)
   * `fact_reason`: `String` (事實及理由全文)
   * `embedding`: `Vector` (事實及理由之向量嵌入，用於語義檢索)
2. **`Entity` (重要實體，採用多重標籤繼承細分類)**:
   * **`Person`**: 如被告、原告、證人、律師、法官。
   * **`Law` (法條)**: 引用法條，如 `中華民國刑法第185-3條`。
   * **`Crime` (罪名)**: 案情涉及的具體罪名，如 `公共危險罪`、`過失傷害罪`。
   * **`Item` (關鍵事證)**: 犯罪工具、涉案物品等。

### 3.2 關係類型 (Relationship Types)
* `(:Judgment)-[:JUDGED_BY]->(:Person {role: "法官"})` (裁判法官)
* `(:Judgment)-[:PLAINTIFF]->(:Person {role: "原告"})` (原告人)
* `(:Judgment)-[:DEFENDANT]->(:Person {role: "被告"})` (被告人)
* `(:Judgment)-[:CITED]->(:Law)` (引用法條)
* `(:Judgment)-[:CHARGED_WITH]->(:Crime)` (涉及罪名)
* `(:Judgment)-[:SIMILAR_TO {score: Float}]->(:Judgment)` (基於向量相似度建立的判決關聯)

---

## 4. 搜尋與檢索演算法 (Search Pipeline)

1. **快取檢索與雜湊**：
   * 使用者輸入 `query`、`courtLevel`、`caseType`、`court`、`judge`、`citedLaw`、`limit` 等搜尋參數。
   * API 先對這些參數的 JSON 字串計算 MD5 雜湊作為 Redis Cache Key。
   * **快取命中 (Cache Hit)**：若 Redis 中存在該 Key，直接讀取並回傳，不向 OpenAI 或 Neo4j 發送請求。
   * **快取未命中 (Cache Miss)**：執行下方 2-5 步，並在成功後寫入 Redis（TTL 3 天）。
2. **向量化**：透過 OpenAI Embedding 將情境描述轉換為 1536 維向量。
3. **混合檢索 (Hybrid Search & Graph Query)**：
   * **步驟 1**：在 Neo4j 中利用 Vector Index（對 `embedding` 屬性）與 Fulltext Index 進行雙管道候選檢索。
   * **步驟 2**：在 Cypher 語句中同時套用軟/硬篩選過濾器：
     * `court_level` 與 `case_type` 的值篩選。
     * **硬過濾條件**：指定法院 (`j.court = $court`)，以及法官與法規的關係硬過濾（使用 `EXISTS { (j)-[:JUDGED_BY]->(:Person {name: $judge}) }` 與 `EXISTS { (j)-[:CITED]->(:Law {name: $citedLaw}) }`）。
   * **步驟 3**：提取出最相似的 `Judgment` 節點，並在 Node.js 中計算混合 RRF (Reciprocal Rank Fusion) 評分進行融合排序。
4. **社群語意命名與詳情裝配**：
   * 批次撈取相似判決書詳情前，執行全域聚合查詢，計算各 Leiden 社群最常引用的前兩名法規：
     `MATCH (j:Judgment)-[:CITED]->(l:Law) WHERE j.community IS NOT NULL RETURN j.community, l.name, count(j)`。
   * 動態產生語意化分群名稱，如 `法律分群 1 (主要引用：刑法第185-3條)`。
   * 撈取判決書的一跳關聯實體（法官、被告、原告、引用法規），並裝配回三欄結果回傳。

---

## 5. 圖譜非同步展開與懶加載 (Graph Expansion)

為了解決大量資料庫節點一次性加載帶來的瀏覽器卡頓，系統設計了非同步圖譜懶加載機制：
1. **二跳擴展 API (`/api/graph/expand`)**：
   * **法條節點 (`law`)**：雙擊展開引用了該法規的最新的 8 筆判決書。
   * **人物節點 (`person`)**：雙擊展開與該法官或當事人相關聯的最新的 8 筆判決書。
   * **判決書節點 (`judgment`)**：雙擊展開與該判決書共享最多引用法規的最相似 5 筆判決書（SIMILAR_TO 關係，二跳推薦）。
2. **前端資料狀態管理**：
   * 前端 `GraphNetwork.tsx` 使用 `vis-network` 的 `DataSet` 管理 `nodes` 與 `edges`，雙擊時調用展開 API 獲取鄰接節點與關係，利用 `DataSet.add` 動態增量寫入並去重，維持節點位置以防圖譜重繪，並帶有流暢的動態引力發散動畫。

---

## 6. 開發指南與階段任務

作為開發代理人，在接續的工作中請遵守：
1. **以 `openspec` 驅動與平台雙向同步**：進行任何 API 實作、圖譜解析或重大代碼重構前，AI 助理必須同時：
   * 在平台指定的路徑建立並維護 `implementation_plan.md`（以通過 AI 平台 UI 的審查解鎖）。
   * 在 `openspec/changes/<change-name>/` 底下建立對應的 `proposal.md`、`design.md` 與 `tasks.md`（以維持專案永久技術規格的完整性與版控）。
2. **語系規範**：本專案的所有代碼註解、說明、終端輸出與前端 UI，**一律採用繁體中文 (Traditional Chinese)**。
3. **模組化**：資料解析、清洗與匯入腳本放在 `frontend/src/scripts/`，Next.js App 結構則放在 `frontend/` 目錄中。
