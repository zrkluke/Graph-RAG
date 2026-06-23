## ADDED Requirements

### Requirement: POST /api/search API 接口
系統 SHALL 提供 POST `/api/search` 接口，接收並處理前端發送的混合檢索請求。

#### Scenario: 成功進行混合檢索
- **WHEN** 前端發送 POST 請求至 `/api/search`，且請求 Body 包含 `query`、`courtLevel`、`caseType` 與 `limit`
- **THEN** 系統回傳 200 OK 狀態碼，並附帶包含相似判決書、去重關聯法條、法官及當事人資訊的 JSON 結構

### Requirement: OpenAI 向量化整合
系統 SHALL 呼叫 OpenAI API，使用 `text-embedding-3-small` 模型將使用者的案情描述文字轉為 1536 維向量。

#### Scenario: 成功取得情境 Embedding 向量
- **WHEN** 後端接收到不為空的 `query` 文字
- **THEN** 系統成功向 OpenAI 取得長度為 1536 的浮點數向量陣列

### Requirement: Neo4j AuraDB 混合檢索
系統 SHALL 使用 `neo4j-driver` npm 套件連線 Neo4j AuraDB Free 雲端實例，執行混合 Cypher 查詢。

#### Scenario: 成功執行 Cypher 獲取關聯數據
- **WHEN** 後端使用查詢向量與過濾器呼叫 Neo4j 資料庫執行查詢
- **THEN** 資料庫成功回傳以最高段落得分 (`max(score)`) 排序的判決書，並提取去重後的法條、法官與當事人
