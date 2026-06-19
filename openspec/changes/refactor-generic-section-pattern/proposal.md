# Proposal: 重構判決書為 Section 通用節點模式 (refactor-generic-section-pattern)

## 1. 摘要 (Summary)
為了解決民事、刑事、行政判決書在結構上的多樣性（例如行政訴訟特有之「事實概要」，刑事特有之「證據能力、論罪科刑、沒收」，以及民事中常見的無子標題段落），本提案建議將原本單一的 `Judgment` 節點正文，拆解為細顆粒度的 `Section` 通用節點。

## 2. 動機與背景 (Motivation & Background)
在第一階段的 ETL 中，我們將整篇判決書的 `事實及理由` 存入 `Judgment.fact_reason` 中。然而，這對未來的 Graph RAG 搜尋是不利的：
* **Token 浪費與稀釋**：判決書全文極長，進行 Embedding 向量化和 RAG 檢索時會引入大量無關 Token。
* **無法精準過濾**：當使用者詢問「原告的主張是什麼？」或「法院的量刑理由是什麼？」時，系統無法單獨檢索特定區塊，必須讀取整篇文本。
* **三大案件結構差異**：
  * 民事判決書有「原告主張」、「被告答辯」、「兩造不爭執事項」、「得心證之理由」。
  * 刑事判決書有「犯罪事實」、「證據能力」、「論罪科刑」、「沒收」。
  * 行政判決書有「程序事項」、「事實概要」、「原告主張」、「被告答辯」、「本院判斷」。

## 3. 解決方案 (Proposed Solution)
在 `openspec/project.md` 的 Schema 設計基礎上，引入統一的 `(:Section)` 標籤節點：
* **通用屬性**：使用 `role`（發言角色，如 plaintiff, defendant, court, prosecutor）與 `type`（區塊類型，如 claims, reasoning, facts_summary 等）來識別不同的法律文本區塊。
* **關係建立**：透過 `(:Judgment)-[:HAS_SECTION {index: Integer}]->(:Section)` 與判決書主節點連接。
* **防漏兜底機制**：若判決書無任何子標題，則將整個正文以單一 `reasoning` 類型寫入，確保不遺漏任何字。

## 4. 影響評估 (Impact)
* **優點**：
  * Schema 保持簡潔（只有一個 `Section` 標籤，而非五六個不同標籤）。
  * 支援精準的 RAG 檢索與獨立向量化（可僅對 `type: "facts"` 或 `type: "reasoning"` 進行語義搜尋）。
  * 完美相容三大案類。
* **缺點**：
  * Ingestion 切分邏輯需引入正則與狀態處理，複雜度略微上升。
