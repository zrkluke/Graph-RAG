# 檢索評估指標 (NDCG@10) 與無 LLM 社群特徵摘要系統設計

本文件說明「法律判決書 Graph RAG 搜尋系統」中，針對檢索排序品質評估與低成本社群摘要特徵生成的設計細節。

---

## 1. 檢索評估指標：NDCG@10 (Normalized Discounted Cumulative Gain)

為了更精準地評估檢索系統的「排序（Ranking）品質」，系統引入了 `NDCG@10` 作為評估指標，與原本的 `Recall@K` 指標並行。

### 1.1 設計動機
- **Recall 缺陷**：Recall 只在意正確結果「有沒有」在 Top-K 候選名單中出現，但無法區分排在第 1 名與排在第 10 名的優劣。
- **NDCG 優勢**：NDCG 引入了對數折現率（Discounting factor），正確結果排序越落後，得分越低。在 RAG（檢索增強生成）中，將最相關的文件放在最前面能有效改善 LLM 的生成品質並降低 Token 浪費。

### 1.2 評估演算法實作
當評估測試集（Gold Standard）中一個問題對應複數個預期判決書 ID 時，相關度分數定義如下：
- $rel_i = 1$：若檢索出排在位置 $i$ 的判決書包含在預期正確 ID 中。
- $rel_i = 0$：若無。

計算公式：
$$DCG@10 = \sum_{i=1}^{10} \frac{rel_i}{\log_2(i + 1)}$$

$$IDCG@10 = \sum_{j=1}^{\min(|expected\_ids|, 10)} \frac{1}{\log_2(j + 1)}$$

$$NDCG@10 = \frac{DCG@10}{IDCG@10}$$

該邏輯實作於 [evaluate_search.ts](file:///c:/PythonSideProjects/判決書搜尋系統/frontend/src/scripts/evaluate_search.ts) 的 `calculateNDCG` 函數中。

---

## 2. 無 LLM 社群特徵摘要 (Combined Community Summaries)

微軟 GraphRAG 等主流框架使用 LLM 來生成每個社群的全局摘要，這在 Free Tier 部署或海量數據下會產生極高昂 API 費用與延遲。
本專案採用 **「三合一無 LLM 社群摘要演算法」**，透過傳統 NLP 與圖譜結構統計在毫秒級內產出高密度的社群特徵摘要。

```
                    ┌────────────────────────┐
                    │  LPA 社群偵測 (Neo4j)   │
                    └───────────┬────────────┘
                                │ (區分群組)
                                ▼
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  【圖譜實體統計】       【N-gram TF-IDF】      【萃取代表句子】
  (Neo4j 關係統計)        (Postgres 文本)       (詞彙匹配與篩選)
  • Top 3 引用法規       • 提取 2-4 grams       • 篩選 50~90字原句
  • Top 3 涉及罪名       • 計算社群特異詞       • 匹配最多核心特徵
  • Top 5 關鍵事證
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │ (融合寫入)
                                ▼
                 ┌─────────────────────────────┐
                 │  community_summaries.json   │
                 │   (輕量快取，供 RAG 載入)    │
                 └─────────────────────────────┘
```

### 2.1 三種方法的融合架構

#### 1. 結構化圖實體統計
利用 Neo4j 拓撲結構，對每個 LPA 社群內的所有判決書節點進行關聯實體統計。找出在該社群中頻率最高的：
- **主要引用法規** (`representative_laws`)
- **涉及罪名** (`representative_crimes`)
- **關鍵事證物證** (`representative_items`)

#### 2. TF-IDF N-gram 關鍵詞提取
將社群對應 Chunks 長文本合併，過濾標點符號與自訂的繁體中文停用詞。
- 提取長度為 2 到 4 的中文 N-grams（例如：「不能安全駕駛」、「酒精濃度」）。
- 以每一個「社群」作為一個獨立的 Document，計算所有詞在該社群的詞頻 ($TF$)。
- 計算在所有社群間的 Document Frequency ($DF$)，並得出 $IDF = \log_2(\frac{N}{DF + 1}) + 1$。
- 計算 $TF \times IDF$ 排序，選出最能代表該社群特殊性質的 Top 10 關鍵詞。

#### 3. 萃取代表性句子 (Extractive Representative Sentence)
- 將社群內的所有 Chunks 分割成單句（以 `。` 切分），並過濾長度在 50~90 字以外的句子。
- 計算每個句子所包含的「Top 關鍵詞」、「主要引用法規」與「代表罪名」的重疊得分。
- 取得分最高的句子作為 `representative_sentence`（例如：「*被告吐氣所含酒精濃度達每公升零點五五毫克以上，仍騎乘重型機車行駛於道路...*」），將抽象的統計轉化為鮮活的具體案例樣貌。

### 2.2 儲存與快取機制
特徵生成腳本 [generate_community_summaries.ts](file:///c:/PythonSideProjects/判決書搜尋系統/frontend/src/scripts/generate_community_summaries.ts) 在社群偵測後執行，將統計數據輸出為一個 JSON 快取檔案：
- **路徑**：[community_summaries.json](file:///c:/PythonSideProjects/判決書搜尋系統/frontend/src/resources/community_summaries.json)

在 RAG 檢索與生成管道中，該 JSON 能被直接在記憶體中快速讀取，避免了與 Neo4j 的反覆統計查詢，同時其高密度的特徵可用於 Query 對社群的語意粗篩。

---

## 3. 資料庫連線生命週期與例外安全 (Exception Safety)

為了防止長時間大批次數據統計時發生網路抖動或斷線導致資源洩漏（Resource Leak），系統採用了嚴格的例外安全連線管理：
- **Session 範疇定義**：Neo4j Session 連線宣告於 `generateSummaries` 的函數主作用域中，並在 `try` 區塊初始化。
- **保證資源釋放 (finally)**：不論資料庫操作成功或中途拋出任何異常，皆透過 `finally` 區塊專用呼叫 `await session.close()`、`await driver.close()` 與 `await pgPool.end()`，確保雲端連線與記憶體資源能被 100% 妥善回收，避免了懸空 Session（Dangling Sessions）造成的資源洩漏風險。
