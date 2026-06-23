## ADDED Requirements

### Requirement: 本地 Leiden 社群偵測腳本
系統應提供一個獨立的 Python 腳本，透過 Leiden 演算法對 Neo4j 中的判決書（Judgment）進行社群劃分，並將社群編號回寫至資料庫中。

#### Scenario: 成功執行社群偵測並寫入資料庫
- **WHEN** 在終端機執行 `python scripts/community_detection.py` 且環境變數配置正確
- **THEN** 系統應利用 `igraph` 及 `leidenalg` 計算判決書之社群，並將計算出的社群 ID（整數）寫入 Neo4j 的 `Judgment` 節點中，屬性名稱為 `community`，最後在終端機輸出計算完成的社群數量與分佈統計。
