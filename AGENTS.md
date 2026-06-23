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

---

## 2. 系統架構設計

```
              ┌──────────────────────────────────────────┐
              │             Vercel 雲端平台               │
              │                                          │
              │  ┌─────────────────┐                     │
              │  │  Next.js 前端   │                     │
              │  │  (React UI)     │                     │
              │  └────────┬────────┘                     │
              │           │ (HTTP)                       │
              │           ▼                              │
              │  ┌─────────────────┐    ┌─────────────┐  │
              │  │ Next.js API 路由│───▶│ OpenAI API  │  │
              │  │ (Serverless API)│    │ (Embedding) │  │
              │  └────────┬────────┘    └─────────────┘  │
              └───────────┼──────────────────────────────┘
                          │ (Bolt over TLS)
                          ▼
              ┌──────────────────────────────────────────┐
              │           Neo4j AuraDB Free              │
              │                                          │
              │  • Document (判決書)                     │
              │  • Entity (被告/法官/法條)               │
              │  • Vector Index (向量搜尋)                │
              └──────────────────────────────────────────┘
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

1. **使用者輸入**：`情境描述`（例：「被告騎腳踏車闖紅燈，撞倒行人致使骨折後逃逸」）與`篩選條件`（例：`court_level` 限制在 "高等法院"）。
2. **向量化**：透過 OpenAI Embedding 將情境描述轉換為 1536 維向量。
3. **混合檢索 (Hybrid Search & Graph Query)**：
   * **步驟 1**：在 Neo4j 中利用 Vector Index 對 `Judgment` 節點的 `embedding` 屬性進行相似度檢索，並套用 `court_level` 屬性過濾器。
   * **步驟 2**：提取出 Top K 筆最相似的 `Judgment` 節點。
   * **步驟 3**：利用圖關係（Graph Relations），順著 `CITED` 與 `CHARGED_WITH` 提取這些相似判決書共同引用的法條 (`Law`) 與罪名 (`Crime`)。
   * **步驟 4**：將判決書內容、提取出的實體關係、關聯法條彙整，提供給前端介面，甚至可選交由 LLM 進行綜合分析與相似度評估。

---

## 5. 開發指南與階段任務

作為開發代理人，在接續的工作中請遵守：
1. **以 `openspec` 驅動與平台雙向同步**：進行任何 API 實作、圖譜解析或重大代碼重構前，AI 助理必須同時：
   * 在平台指定的路徑建立並維護 `implementation_plan.md`（以通過 AI 平台 UI 的審查解鎖）。
   * 在 `openspec/changes/<change-name>/` 底下建立對應的 `proposal.md`、`design.md` 與 `tasks.md`（以維持專案永久技術規格的完整性與版控）。
2. **語系規範**：本專案的所有代碼註解、說明、終端輸出與前端 UI，**一律採用繁體中文 (Traditional Chinese)**。
3. **模組化**：擷取與解析腳本放在 `scripts/`，Next.js App 結構放在 `frontend/` (或根目錄的 `app/`)。
