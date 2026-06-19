## Architecture

本搜尋演算法採用的混合檢索流程（Hybrid Retrieval）與資料流向如下：

```mermaid
graph TD
    User([使用者情境描述]) -->|自然語言文字| API[OpenAI Embedding API]
    API -->|1536維向量| Pipeline[混合搜尋演算法 search_pipeline.py]
    
    subgraph Neo4j AuraDB Free
        Index[section_embedding_index] -->|餘弦相似度匹配| Sec[Section 段落節點]
        Sec -->|HAS_SECTION 反向查找| Judg[Judgment 判決書節點]
        Judg -->|PLAINTIFF / DEFENDANT| Person[Person 關係人節點]
        Judg -->|CITED| Law[Law 引用法條節點]
    end
    
    Pipeline -->|向量查詢| Index
    Neo4j AuraDB Free -->|返還圖譜結構資料| Pipeline
    Pipeline -->|過濾與排序好的 JSON 列表| UI[Gradio 本地測試網頁 UI]
```

---

## Data Structures

### 1. 節點屬性變更
* **`Section` 節點**：新增 `embedding` 屬性。
  * `embedding`: `List<Float>` (長度為 1536 的浮點數數組，存放由 OpenAI `text-embedding-3-small` 生成的語意向量)。

### 2. 向量索引建立
於資料庫初始化時，執行以下 Cypher 指令建立向量索引：
```cypher
CREATE VECTOR INDEX section_embedding_index IF NOT EXISTS
FOR (s:Section) ON (s.embedding)
OPTIONS {indexConfig: {
  `neo4j.vector.dimensions`: 1536,
  `neo4j.vector.similarity_function`: 'cosine'
}}
```

---

## Algorithm / Logic

### 1. 混合檢索 Cypher 核心查詢邏輯

混合檢索不需 LLM 生成文字，而是直接向資料庫查詢符合條件的判決書，其 Cypher 查詢如下：

```cypher
// 1. 向量相似度搜尋最相近的 Section 節點
CALL db.index.vector.queryNodes('section_embedding_index', $topK, $queryVector)
YIELD node AS sec, score

// 2. 透過關係上溯至 Judgment 判決書節點
MATCH (j:Judgment)-[r:HAS_SECTION]->(sec)

// 3. 套用使用者篩選條件 (例如法院層級、案件大類)
WHERE ($court_level IS NULL OR j.court_level = $court_level)
  AND ($case_type IS NULL OR j.case_type = $case_type)

// 4. 提取判決書關聯的實體（法官、被告、原告、法條）
OPTIONAL MATCH (j)-[:JUDGED_BY]->(judge:Person)
OPTIONAL MATCH (j)-[:DEFENDANT]->(defendant:Person)
OPTIONAL MATCH (j)-[:PLAINTIFF]->(plaintiff:Person)
OPTIONAL MATCH (j)-[:CITED]->(law:Law)

// 5. 聚合實體與計算相似度加權評分
RETURN 
  j.id AS id,
  j.court AS court,
  j.court_level AS court_level,
  j.case_type AS case_type,
  j.reason AS reason,
  j.main_text AS main_text,
  max(score) AS max_section_score, // 最相似的段落分數
  collect(distinct judge.name) AS judges,
  collect(distinct defendant.name) AS defendants,
  collect(distinct plaintiff.name) AS plaintiffs,
  collect(distinct law.name) AS cited_laws
ORDER BY max_section_score DESC
LIMIT $limit
```

---

## Dependencies

專案的 Python 虛擬環境 (`.venv`) 需要安裝以下新依賴：
1. **`openai`** (>=1.0.0)：用於將使用者輸入的情境描述轉換為 Embedding 向量。
2. **`gradio`**：用於快速搭建本地網頁端 UI 介面。

---

## API / Interface

### 1. 搜尋程式碼介面 (`scripts/search_pipeline.py`)
```python
def search_similar_judgments(
    query_text: str, 
    court_level: str = None, 
    case_type: str = None, 
    limit: int = 5
) -> list[dict]:
    """
    執行混合搜尋：
      1. 調用 OpenAI API 獲取 query_text 的 1536 維向量。
      2. 執行混合檢索 Cypher 查詢。
      3. 回傳過濾、排序後的判決書與關聯實體字典列表。
    """
```

### 2. 本地 UI 原型啟動指令
```bash
python scripts/search_ui.py
```
啟動後會輸出本地伺服器網址（例如 `http://127.0.0.1:7860`），使用者可在瀏覽器中打開網頁，輸入任意犯罪描述，並即時查閱匹配到的相似判決書、被告與法條統計。
