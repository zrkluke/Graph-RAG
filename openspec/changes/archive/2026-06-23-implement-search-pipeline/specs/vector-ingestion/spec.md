## ADDED Requirements

### Requirement: 建立 Section 向量索引
系統必須於資料庫連線初始化時，對 `Section` 節點的 `embedding` 屬性建立 1536 維的向量索引（採用 Cosine 相似度計算），以提供高速的語意搜尋。

#### Scenario: 成功建立向量索引
- **WHEN** 執行初始化資料庫索引指令
- **THEN** 資料庫中成功建立一個名為 `section_embedding_index` 的向量索引，維度為 1536，相似度函數為 `cosine`

### Requirement: Section 節點批量 Embedding 補全
系統必須能夠遍歷資料庫中所有尚未生成 `embedding` 屬性的 `Section` 節點，調用 OpenAI Embedding API (模型 `text-embedding-3-small`，1536維) 獲取向量，並將向量寫回對應的 `Section` 節點。

#### Scenario: 成功批次生成並更新向量
- **WHEN** 執行向量補全腳本
- **THEN** 資料庫中所有原先缺少 embedding 的 `Section` 節點皆被成功更新，且不重複寫入已存在向量的節點
