# 法律判決書資料導入與清洗指南 (data_ingestion_guide.md)

本指南定義本專案第一階段之資料導入（Ingestion）、文本清洗（Text Cleaning）、法條與當事人抽取（Statute & Person Extraction）的技術原理與操作方式。


本專案借鏡並參考了 WeHelp 代表性專案 `Lawcidity` 的設計。目前階段**專注於 Graph 圖資料庫的建立**，以利未來在 Neo4j 上實作包含關鍵字搜尋、模糊搜尋、向量搜尋、Graph Search 與 Metadata Filtering 的混合檢索與 RRF（Reciprocal Rank Fusion）加權排序。

---

## 1. 資料源與輸入格式

* **資料路徑**：`data/202604/` 下的各個法院/案件分類子資料夾。
* **檔案格式**：JSON 檔案。
* **欄位結構**：
  * `JID`: 判決唯一 ID（如 "TPDV,111,消,17,20260430,1"）
  * `JYEAR`: 年度（如 "111"）
  * `JCASE`: 案科/案由別（如 "消"、"訴"）
  * `JNO`: 案號（如 "17"）
  * `JDATE`: 裁判日期（YYYYMMDD 格式）
  * `JTITLE`: 案由簡述（如 "損害賠償"）
  * `JFULL`: 判決書全文大文本
  * `JPDF`: 原始 PDF 連結

---

## 2. 法院與案件種類解析 (Court & Case Type Parser)

我們透過判決書存放的**資料夾名稱**直接獲得標準的法院層級與案件種類分類，用作未來 Metadata Filtering 的基礎。

### 2.1 解析規則 (參考 `court_parser.py` 與 `court_mapping.py`)
遍歷資料夾時，利用正則表達式解析子資料夾名稱（如 `臺灣臺北地方法院民事`、`最高法院刑事`、`臺北高等行政法院行政`）：
* **案件種類 (case_type)**：
  * 若資料夾包含 `民事` -> `"民事"`
  * 若資料夾包含 `刑事` -> `"刑事"`
  * 若資料夾包含 `行政` -> `"行政"`
* **法院層級 (court_level)**：
  * 若資料夾包含 `最高法院` 或 `最高行政` -> `"最高法院"`
  * 若資料夾包含 `高等法院` 或 `高等行政` -> `"高等法院"`
  * 若資料夾包含 `地方法院` 或 `簡易庭` -> `"地方法院"`
* **法院標準名稱 (court)**：
  * 去除結尾的案件類型後，進行名稱對應。例如 `臺灣臺北地方法院民事` -> `"臺灣臺北地方法院"`；`最高法院刑事` -> `"最高法院"`。

---

## 3. 文本清理與段落切片 (Text Cleaner & Chunking)

為了未來的全文檢索與 Graph 語義檢索，我們需要將原始大文本清理乾淨，並切分成邏輯區塊。

### 3.1 文本清理與段落切片流程
詳細的文字正規化、除重複空白、段落折行合併等 ETL 原理請參見 [scripts/text_cleaner.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/text_cleaner.py)。

---

## 4. 法條與關係人抽取 (Extractor)

為了在 Neo4j 中建立精確的實體圖譜，以利未來的 Graph Search，我們需抽取以下實體：
* **法條精確抽取**：利用狀態機三層解析與現行主要法規白名單，從文本中提取標準法條（如 `中華民國刑法第185-3條`），其具體解析器代碼請見 [scripts/statute_parser.py](file:///c:/PythonSideProjects/Neo4j-GraphRAG/scripts/statute_parser.py)。
* **關係人抽取**：利用正規表示式識別首段關係人，標記出法官、原告、被告、訴訟代理人與辯護律師。

## 5. 圖資料庫 Schema 與寫入 (Neo4j Schema)

為了維持規格設計的唯一權威來源 (Single Source of Truth)，有關圖資料庫的詳細 Schema 映射、Mermaid 關係圖以及 Cypher 寫入與 Transaction 語法，**請統一參閱專案規格說明書：[openspec/project.md](file:///c:/PythonSideProjects/Neo4j-GraphRAG/openspec/project.md#L66-L105)**。

---

## 6. 檢索與未來擴充設計 (Future Extensibility)

本專案在 Ingestion 階段即預留了良好的混合檢索擴充性：
1. **全文檢索 (Full-Text Search)**：針對 `Judgment` 的 `main_text` 與 `fact_reason` 建立 `judgment_text_index` 全文索引，用以提供高效率的關鍵字與模糊字詞檢索。
2. **段落向量檢索 (Section Vector Search)**：未來的第二階段，我們可以使用 OpenAI Embedding API 針對每個 `Section` 的 `text` 內容進行向量化，寫入 `Section.embedding` 並建立 Vector Index。這使得我們可以針對個別段落（如事實、理由或主張）進行極具語義精準度的相似度搜尋，避免傳統長文本被稀釋的缺點。
3. **Metadata Filtering (多重過濾)**：`Judgment` 節點所擁有的屬性（如 `court`、`court_level`、`case_type`、`date`）均建立為過濾維度，能與向量搜尋及圖譜路徑推理結合進行複雜的 Cypher 混合檢索。

