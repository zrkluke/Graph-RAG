# 法律判決書 Graph RAG 搜尋與分析系統 — 專案規格說明書 (project.md)

本文件作為此專案的「世界觀（Global Context / Worldview）」與核心規格說明，旨在讓所有 AI 協同開發助手能快速且精確地理解本專案的設計哲學、架構組成與開發規範。

---

## 1. 專案概述

### 1.1 目標
建構一個基於 **Neo4j AuraDB Free 圖資料庫**、**Next.js (Vercel)** 與 **大語言模型 (LLM)** 的智慧型法律判決書搜尋與知識圖譜分析系統。

### 1.2 核心價值
* **混合式搜尋**：結合向量相似度檢索（針對犯罪情境描述）與圖譜路徑推理（針對法條引用、罪名關聯與法院層級篩選）。
* **極致省錢部署**：
  * **前端與後端 API**：完全託管於 Vercel 的免費額度中，使用 Next.js Serverless Route Handlers，免除租用獨立 Python 伺服器的固定成本。
  * **圖資料庫**：使用 Neo4j AuraDB Free 雲端實例，支援最多 20 萬節點與 40 萬關係，免信用卡且完全免費。

---

## 2. 系統架構

專案採全棧 Next.js 應用程式架構，直接連線至雲端免費的圖資料庫與快取層：

```
                    ┌──────────────────────────────┐
                    │       Vercel (Next.js)       │
                    │                              │
                    │   ┌──────────────────────┐   │
                    │   │  React 前端 UI       │   │
                    │   └──────────┬───────────┘   │
                    │              │ (HTTPS)       │
                    │              ▼               │
                    │   ┌──────────────────────┐   │
                    │   │ Serverless API 路由  │   │
                    │   │ (Next.js Route)      │   │
                    │   └──────┬───────────┬───┘   │
                    └──────────┼───────────┼───────┘
                               │           │ (MD5 Cache)
                  (Bolt / Sec) │           ▼
                               │   ┌───────────────┐
                               │   │ Upstash Redis │
                               │   │ (極速快取層)  │
                               │   └───────────────┘
                               ▼
                    ┌──────────────────────────────┐
                    │      Neo4j AuraDB Free       │
                    │                              │
                    │ • 判決書與法律實體關聯圖譜   │
                    │ • 向量相似度索引             │
                    └──────────────────────────────┘
```

### 2.1 數據導入模組 (Data Ingestion Script)
* 開發獨立的 TypeScript 解析腳本（位於 `frontend/src/scripts/`），用以讀取司法院 OpenData 的判決書 JSON 檔案。
* 執行數據清洗、文字分塊與實體擷取，並批量寫入 Neo4j。

### 2.2 實體與關係擷取 (NER)
* 從判決全文中辨識出重要實體：
  * **人名 (Person)**：被告、原告、法官、律師、證人。
  * **引用法條 (Law)**：如刑法第185-3條。
  * **涉及罪名 (Crime)**：如公共危險罪、過失致死罪。
  * **關鍵事證 (Item)**：如呼氣酒精濃度、凶器等。

### 2.3 搜尋與圖譜檢索模組
* **向量檢索**：將使用者的「自然語言情境描述」轉為 1536 維 Embedding，在 Neo4j 的 Vector Index 中檢索最相似的 `Judgment` 節點。
* **屬性過濾**：在 Cypher 查詢中動態套用 `court_level` 限制條件（如 "最高法院"、"高等法院"、"地方法院"）。
* **關係擴展**：檢索出相似判決後，延展出其高度關聯的引用法條與罪名，並計算共現頻率以供分析。

### 2.4 快取檢索機制 (Redis Cache Layer)
* **快取讀寫流**：API 接收到搜尋請求時，以查詢字串與過濾參數的組合進行 MD5 Hash 生成唯一的 Cache Key `search:cache:<hash>`。
* **讀取優先**：優先從 Upstash Redis 讀取，若命中則直接回傳（整體 API 耗時 <20ms）；若未命中則執行 OpenAI Embedding 與 Neo4j 檢索，並將結果非同步寫入 Redis（設定 TTL 為 3 天）。
* **安全降級 (Fallback)**：若 Redis 連線失敗或服務異常，API 將自動忽略快取錯誤，無縫降級為 Neo4j 即時圖檢索，確保搜尋服務高可用。

---

## 3. 資料模型設計 (Data Schema)

```mermaid
classDiagram
    class Judgment {
        id: String
        case_type: String
        court: String
        court_level: String
        date: Date
        reason: String
        main_text: String
        fact_reason: String
    }
    class Section {
        id: String
        role: String
        type: String
        text: String
        embedding: null
    }
    class Law {
        name: String
    }
    class Person {
        name: String
    }
    
    Judgment --> Section : HAS_SECTION {index: Integer}
    Judgment --> Law : CITED
    Judgment --> Person : DEFENDANT / PLAINTIFF / JUDGED_BY / REPRESENTED_BY
```

### 3.1 節點類型 (Node Labels)
* **`Judgment` (判決書)**：
  * `id`: 判決字號（Unique Constraint）
  * `case_type`: 案件種類（民事 / 刑事 / 行政）
  * `court`: 法院名稱
  * `court_level`: 法院層級（最高法院 / 高等法院 / 地方法院）
  * `date`: 判決日期 (Date)
  * `reason`: 案由
  * `main_text`: 主文
  * `fact_reason`: 事實及理由全文
* **`Section` (段落區塊)**：
  * `id`: 區塊唯一ID（Unique Constraint，格式為 `"{jid}_sec_{index}"`）
  * `role`: 發言角色（plaintiff / defendant / court / prosecutor）
  * `type`: 區塊類型（facts / facts_summary / claims / uncontested / reasoning / evidence_ability / sentencing / confiscation / procedure）
  * `text`: 本段落清洗後的純文字內容
  * `embedding`: 1536 維向量（目前預留為 null，未來供向量搜尋使用）
* **`Person` (相關人名)**：
  * `name`: 姓名（Unique Constraint）
* **`Law` (法條)**：
  * `name`: 法條名稱（Unique Constraint，如「中華民國刑法第185-3條」）

### 3.2 關係類型 (Relationship Types)
* `(:Judgment)-[:HAS_SECTION {index: Integer}]->(:Section)` (按順序指向各文本段落)
* `(:Judgment)-[:DEFENDANT]->(:Person)`
* `(:Judgment)-[:PLAINTIFF]->(:Person)`
* `(:Judgment)-[:JUDGED_BY]->(:Person)`
* `(:Judgment)-[:REPRESENTED_BY]->(:Person)`
* `(:Judgment)-[:CITED]->(:Law)`
* `(:Judgment)-[:SIMILAR_TO {score: Float}]->(:Judgment)` (基於向量相似度建立的判決關聯)

### 3.3 索引策略
* 對 `Judgment(id)`、`Section(id)`、`Law(name)`、`Person(name)` 建立 `CONSTRAINT` 唯一性約束。
* 針對 `Section(embedding)` 建立 Neo4j Vector Index，命名為 `section_vector_index`。
* 針對 `Judgment(main_text, fact_reason)` 建立 Neo4j Full-Text Index，命名為 `judgment_text_index`。


---

## 4. 開發與部署規範

### 4.1 開發工作流
1. 所有的代碼結構、API 行為、資料庫架構異動，皆需先利用 OpenSpec CLI 發起 Proposal 規格書，並在 `openspec/` 下進行管理。
2. 敏感變更或資料庫連接字串（如 `NEO4J_URI`, `NEO4J_PASSWORD`, `OPENAI_API_KEY`）一律配置於 `.env.local` 中，且絕對不得提交至版本控制系統。

### 4.2 語系規範
* 本專案的程式碼註解、變數命名說明、介面文案、說明文件等，**一律採用繁體中文 (Traditional Chinese)**。
