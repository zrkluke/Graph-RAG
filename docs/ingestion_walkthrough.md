# 法律判決書 Graph Ingestion ETL 實作與 Section 重構報告 (ingestion_walkthrough.md)

本報告記錄了第一階段「法律判決書 Graph 資料庫 Ingestion 與 ETL」的實作與重構成果。我們成功實現了將判決書的「事實及理由」正文拆解為細顆粒度的 **Section 通用節點模式**（Section Generic Node Pattern），以支援未來混合搜尋、多重過濾與 RRF 加權排序。

---

## 1. 檔案結構異動

我們在 `scripts/` 與 `docs/` 下完成的檔案結構調整如下：

*   **Ingestion 核心腳本**：
    *   [import_judgments.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/import_judgments.py)：主入口匯入腳本。引入 `judgment_splitter`，在 ETL 過程中將判決正文切成段落，並使用 Cypher Transactions 將 `(:Section)` 節點與 `[:HAS_SECTION {index}]` 關係寫入 Neo4j。
    *   [judgment_splitter.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/judgment_splitter.py)：**[新增]** 通用段落切分器。利用正則表達式偵測 `程序事項`、`事實概要`、`主張與答辯`、`得心證理由` 等子標題，並提供 Fallback 兜底機制（防止漏字）。
*   **ETL 清洗與解析模組**：
    *   [court_parser.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/court_parser.py)：從資料夾名稱解析案件類型與法院層級。
    *   [court_mapping.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/court_mapping.py)：台灣各法院與簡易庭層級映射。
    *   [text_cleaner.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/text_cleaner.py)：清洗判決書大文本，去除重複空白與硬折行。
    *   [statute_parser.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/statute_parser.py)：抽取標準法條。
    *   [law_names.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/law_names.py)：收錄台灣現行法規名稱與常用簡稱。
*   **單元測試腳本**：
    *   [test_parser.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/test_parser.py)：新增 `test_judgment_splitter` 測試，使用民事、刑事、行政等真實案例，驗證切分結果的精確度與兜底機制。

---

## 2. 測試與驗證結果

### 2.1 單元測試驗證
執行虛擬環境中的單元測試 `.venv\Scripts\python.exe -m unittest scripts/test_parser.py`，四個測試案例全數通過，無任何失敗：
```text
Ran 4 tests in 0.010s

OK
```

### 2.2 小批量匯入驗證（20 筆）
執行匯入指令 `.venv\Scripts\python.exe scripts/import_judgments.py --limit 20`，結果 **100% 成功，無任何錯誤**。

### 2.3 Neo4j 資料庫狀態驗證
透過自研的驗證腳本 `verify_neo4j_data.py` 查詢 Neo4j AuraDB，回傳的節點、關係與全文索引狀態如下：

*   **節點統計**：
    *   `Judgment` (判決書) 節點：**20 個**
    *   `Section` (段落區塊) 節點：**23 個** (代表民/刑/行各區塊成功被拆分)
    *   `Law` (引用法規) 節點：**49 個**
    *   `Person` (關係人) 節點：**24 個**
*   **關係統計**：
    *   `HAS_SECTION` 關係：**23 條** (成功關聯各 Section 區塊)
    *   `CITED` 關係：**72 條**
    *   `JUDGED_BY` 關係：**20 條**
    *   `REPRESENTED_BY` 關係：**14 條**
    *   `DEFENDANT` 關係：**8 條**
    *   `PLAINTIFF` 關係：**4 條**
*   **全文檢索索引狀態**：
    *   索引名稱：`judgment_text_index`，狀態：`ONLINE`，套用欄位：`[Judgment.main_text, Judgment.fact_reason]`

### 2.4 Section 拆分與屬性映射細節
經手動 Cypher 查詢驗證：
*   **民事案件** (如 `SJEV,113,重建簡,104`) 成功切分為：
    *   `Sec #1: type: "claims", role: "plaintiff"` (原告主張之事實與訴求)
    *   `Sec #2: type: "reasoning", role: "court"` (得心證之理由)
*   **無標題簡易案件** (如 `SJEM,115,重秩,29`) 成功啟動 Fallback 兜底機制：
    *   `Sec #1: type: "reasoning", role: "court"` (整篇正文完整保留在此區塊，保障不漏字)

---

## 3. 未來檢索擴充性
重構後的 `(:Section)` 節點結構，為我們未來的混合檢索設計打下了堅實基礎：
1.  **段落精確向量化**：第二階段可僅對 `Section.text` 進行 Embedding 並建立 `section_vector_index`，大幅提高語義相似度搜尋的準確度。
2.  **屬性過濾與關聯推理**：可透過 `Section.type` 與 `role` 屬性進行精準過濾，快速定位原告主張、被告答辯或法院論證。
