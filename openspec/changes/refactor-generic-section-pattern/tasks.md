# Implementation Tasks: Section 通用節點模組開發 (refactor-generic-section-pattern)

本文件列出完成此變更所需的具體開發任務清單。

## 1. 核心代碼開發

- [ ] **任務 1.1**：建立 [scripts/judgment_splitter.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/judgment_splitter.py)
  - 實作正則定義與切片定位函數。
  - 實作主函數 `split_judgment_into_sections(case_type: str, clean_text: str) -> list[dict]`。
  - 實作 Fallback 兜底機制。

- [ ] **任務 1.2**：重構 [scripts/import_judgments.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/import_judgments.py)
  - 引入 `judgment_splitter.py`。
  - 修改 `batch_import` 中的 Cypher Transaction，加入 `Section` 節點與 `[:HAS_SECTION]` 關係的寫入邏輯。

- [ ] **任務 1.3**：更新 [scripts/test_parser.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/test_parser.py)
  - 新增 `test_judgment_splitter` 單元測試。
  - 使用民事（如 `TPDV,111,消,17`）、刑事（如 `TPDM,111,訴,1263`）、行政（如 `TPBA,109,訴,395`）這三類真實樣本，對切分結果進行斷言測試。

---

## 2. 測試與驗證

- [ ] **任務 2.1**：執行自動化單元測試
  - 執行 `python -m unittest scripts/test_parser.py` 確保全部通過。

- [ ] **任務 2.2**：小批量導入測試
  - 執行 `python scripts/import_judgments.py --limit 20` 寫入 Neo4j AuraDB。

- [ ] **任務 2.3**：手動 Cypher 查詢驗證
  - 在 Neo4j Browser 執行 `MATCH (j:Judgment)-[r:HAS_SECTION]->(s:Section) RETURN j, r, s LIMIT 10`。
  - 驗證屬性、關係與節點欄位無誤。
