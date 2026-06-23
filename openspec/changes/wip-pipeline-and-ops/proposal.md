# Proposal: 資料流水線、自動同步與連線池維運優化 (wip-pipeline-and-ops)

## 1. 摘要 (Summary)
本提案旨在提升資料庫維運健康度與增量資料導入流水線的效率與穩定性。包含對歷史舊資料進行全量重新分塊與向量補全、自動化社群偵測更新、環境變數同步、AuraDB 連線池死結優化，並實作基於 Supabase Postgres 作為任務佇列 (Job Queue) 搭配 Vercel Cron 定時 Pull 的高可靠性、防封鎖增量同步流水線。

## 2. 核心設計構想 (Design Concepts)
* **死結與連線池優化**：針對 Neo4j AuraDB 免費版連線數低且易觸發死結 (Forseti Deadlock) 的痛點，重構資料寫入事務，採用 Driver 內建的 `executeWrite()` 自動重試機制。
* **Supabase Backed Queue 流水線**：
  * Vercel Cron 每日定時向 Supabase `jobs` 表批量新增待更新的 JID。
  * 每分鐘執行一個輕量 Consumer 任務拉取待處理任務，以溫和的速度 (如 1 筆/秒，利用 `p-limit`) 向司法院拉取全文並寫入 Neo4j，避免因請求過快觸發防爬蟲封鎖。
  * 提供自建的後台管理儀表板，展示同步成功/失敗數據，並提供失敗任務的重試按鈕。
