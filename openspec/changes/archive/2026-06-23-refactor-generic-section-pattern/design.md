# Technical Design: Section 通用節點模組設計 (refactor-generic-section-pattern)

## 1. 架構概述
本設計將 Ingestion ETL 流程中的正文寫入邏輯進行解耦。新增 `judgment_splitter.py` 作為獨立的段落切分器，解析出各段落的屬性後，交由 `import_judgments.py` 的 Cypher Transaction 批量寫入 Neo4j。

## 2. 圖資料庫 Schema

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

### 屬性定義與語意：
* **`Section.role`**：
  * `plaintiff`：原告、起訴人、聲請人
  * `defendant`：被告、答辯人
  * `prosecutor`：檢察官、公訴人
  * `court`：法院、法官
* **`Section.type`**：
  * `procedure`：程序事項
  * `facts`：事實、犯罪事實
  * `facts_summary`：事實概要
  * `claims`：主張、訴求、答辯與抗辯內容
  * `uncontested`：兩造不爭執事項
  * `evidence_ability`：證據能力
  * `sentencing`：論罪科刑與量刑
  * `confiscation`：沒收
  * `reasoning`：本院之判斷/得心證之理由

---

## 3. 切分演算法與正規表示式

段落切片主要在 `事實及理由`（或 `理由`、`事實`）區塊下進行：
* **程序事項 (`procedure`)**：匹配 `(程序事項|程序方面|程序部分|壹、程序)`
* **事實概要 (`facts_summary`)**：匹配 `(事實概要|二、事實概要)`
* **原告主張 (`claims` / `role: "plaintiff"`)**：匹配 `(原告(?:起訴|之)?主張|上訴人主張|原告起訴主張|原告主張略以)`
* **被告答辯 (`claims` / `role: "defendant"`)**：匹配 `(被告(?:答辯|抗辯|則以)|答辯人答辯略以|被告答辯則以)`
* **不爭執事項 (`uncontested`)**：匹配 `(兩造不爭執事項|不爭執事項|不爭執之事實)`
* **本院判斷 (`reasoning`)**：匹配 `(本院(?:之)?判斷|得心證之理由|理由|本院判斷如下)`
* **犯罪事實 (`facts` / `role: "court"`)**：匹配 `(犯罪事實|事實|犯罪之事實)`
* **證據能力 (`evidence_ability`)**：匹配 `(證據能力|關於證據能力)`
* **論罪科刑 (`sentencing`)**：匹配 `(論罪科刑|量刑理由)`
* **沒收 (`confiscation`)**：匹配 `(沒收|關於沒收)`

### 兜底邏輯：
若未匹配到任何上述標題，則將整個段落正文視為一個 `(:Section {role: "court", type: "reasoning"})` 寫入。
