# Tasks: 知識圖譜 Schema 擴充與演算法優化待辦清單 (wip-graph-and-algorithms)

## 1. 知識圖譜 Schema 擴充與 NER 優化
- [ ] **任務 1.1**：實作罪名實體抽取 (`:Crime` 節點) 與建立 `(:Judgment)-[:CHARGED_WITH]->(:Crime)` 關係。
- [ ] **任務 1.2**：實作關鍵事證抽取 (`:Item` 節點) 抽取如呼氣酒精濃度、凶器等。
- [ ] **任務 1.3**：評估多重標籤繼承，使 `Person`, `Law`, `Crime` 等統一繼承 `Entity` 標籤。
- [ ] **任務 1.4**：解決當事人 (`:Person`) 節點之同名同姓實體混淆與去重問題。
- [ ] **任務 1.5**：針對法官與律師等超級節點 (`Supernodes`) 進行查詢效能優化與剪枝。
- [ ] **任務 1.6**：將扁平的法規 (`:Law`) 節點重構為層級化/樹狀關係。
- [ ] **任務 1.7**：建立案件審級與上訴歷程關係 (`:APPEALED_FROM` / `:REVERSED` 關係)。

## 2. 向量搜尋與圖譜推理演算法
- [ ] **任務 2.1**：在後端預計算 Judgment 相似度，並在 Neo4j 中建立 `(:Judgment)-[:SIMILAR_TO {score: Float}]->(:Judgment)` 關係。
- [ ] **任務 2.2**：實作 OpenAI Embedding 快取機制與成本控管（避免重複情境查詢重複調用 API）。
- [ ] **任務 2.3**：解決免費版 AuraDB 20 萬節點上限限制（研究本地 Neo4j 社群版遷移或高價值抽樣）。
- [ ] **任務 2.4**：實作實體與屬性的圖譜硬約束過濾能力。
- [ ] **任務 2.5**：實作判決脈絡的多跳推理探索與推薦。
- [ ] **任務 2.6**：實作圖文分離架構 (Polyglot Persistence)，長文本移出 Neo4j 以維持走訪效能。
- [ ] **任務 2.7**：結合 LPA 社群標籤實作社群摘要檢索 (Community Summary RAG)。

## 3. 檢索品質評估與生成優化
- [ ] **任務 3.1**：實作 LLM 綜合分析與回答面板 (RAG Generation Phase) 對話框。
- [ ] **任務 3.2**：建立包含 20-30 個查詢的檢索評估黃金測試集 (Evaluation Gold Standard)。
- [ ] **任務 3.3**：實作 Lucene Score 與 Vector Cosine Similarity 的分數正規化與權重調優。
- [ ] **任務 3.4**：優化中文全文檢索分詞器，評估 `cjk` 索引或前端 `Jieba` 客戶端分詞。
