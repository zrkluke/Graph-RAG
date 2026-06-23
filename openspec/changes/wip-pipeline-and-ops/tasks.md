# Tasks: 資料流水線與維運優化待辦清單 (wip-pipeline-and-ops)

## 1. 系統維運與基礎優化
- [ ] **任務 1.1**：執行全量歷史判決書資料之重新分塊 (Chunking) 與 Embedding 向量補全覆蓋更新。
- [ ] **任務 1.2**：將 LPA 社群偵測腳本整合至 Ingestion 寫入流水線中，實現自動化執行。
- [ ] **任務 1.3**：開發環境變數一鍵同步腳本（同步根目錄 `.env` 與 `frontend/.env.local`）。
- [ ] **任務 1.4**：重構寫入 API，改用 `executeWrite()` 自動交易重試，避免連線數溢出與 Forseti 死結。

## 2. 增量導入與 Supabase Queue 流水線
- [ ] **任務 2.1**：在 `vercel.json` 配置台灣時間凌晨 1:00 觸發的 Cron 同步排程，對接司法院開放 API 進行增量獲取與不公開案件物理刪除。
- [ ] **任務 2.2**：確保增量寫入之冪等性 (Idempotency)──寫入新 Section 前物理清除舊節點關係。
- [ ] **任務 2.3**：於 Supabase Postgres 建立 `jobs` 資料表作為任務緩衝佇列。
- [ ] **任務 2.4**：實作發布者 (Publisher) API，定時將當日異動 `JList` Bulk Insert 至 `jobs` 表。
- [ ] **任務 2.5**：實作消費者 (Consumer) API，每分鐘拉取前 20 筆 pending 任務（防重複消費鎖定）。
- [ ] **任務 2.6**：在 Consumer 中整合 `p-limit` 控制請求速率（如 1 筆/秒），防止司法院防爬蟲封鎖。
- [ ] **任務 2.7**：實作垃圾回收機制（處理成功後刪除 Job 或定期批次清理歷史）。

## 3. 同步監控儀表板 (Sync Dashboard)
- [ ] **任務 3.1**：於 Next.js 實作受密碼保護的管理員後台網頁，即時展示 Supabase `jobs` 同步狀況。
- [ ] **任務 3.2**：列出失敗的任務，展示錯誤日誌並提供手動重試功能。
