# Design: 前端 UI/UX 三階段深度優化重構 (frontend-ui-ux-revamp)

本文件詳細說明本專案前端 UI/UX 三階段優化重構的技術架構與設計細節。

---

## 1. 元件架構設計 (Component Hierarchy)

我們將直接在 `frontend/src/app/page.tsx` 中整合並重構以下 UI 元件：

```
Home (Page Component)
 ├── Header (頂部狀態與連線標記)
 └── Main (主內容區)
      ├── Left Sidebar (搜尋配置欄)
      └── Results Panel (結果展示區)
           ├── Dashboard Summary (卡片統計數據)
           ├── Tabs Controller (📋 比對對照 | 🕸️ 關聯圖譜)
           ├── Layout Mode Switcher (🔬 演算法三欄比對 | 📖 經典雙欄閱讀)
           │
           ├── [layoutMode === 'compare']
           │    └── Grid-3-Cols (三欄 Accordion 清單)
           │         └── Card (簡潔卡片 + "📖 閱讀全文" 按鈕)
           │
           ├── [layoutMode === 'classic']
           │    └── Split-2-Panels (雙欄配置網格)
           │         ├── Left Panel (35% 寬度的簡潔結果清單)
           │         └── Right Panel (65% 寬度的常駐型 VerdictReader)
           │
           └── Drawer Overlay (右側滑出式抽屜，僅在 compare 模式或行動版開啟)
                └── VerdictReader (智慧判決書閱讀器)
```

---

## 2. 智慧判決書閱讀器 (VerdictReader) 設計

`VerdictReader` 是本重構的核心展示區塊，負責將繁雜的判決書文字轉化為結構化且易於閱讀的資訊流。

### 2.1 段落導航錨點 (Table of Contents - TOC)
由於判決書本文過長，我們在閱讀器旁（大螢幕為左側邊欄，小螢幕為頂部）常駐一個小目錄：
* **📢 判決主文**：跳轉至主文段落 (`#verdict-main-text`)。
* **📝 事實與理由**：跳轉至事實與理由段落 (`#verdict-facts-reason`)。
* **🔗 相似案例推薦**：跳轉至推薦區塊 (`#verdict-recommendations`)。
* **技術實現**：在對應的 HTML 容器加上 `id` 屬性，點擊目錄按鈕時執行：
  ```typescript
  document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' });
  ```

### 2.2 雙步替換實體高亮演算法 (Token-based Entity Highlighting)
為了解決在 HTML 文字中直接高亮多重實體時，常因為關鍵字巢狀（如：人名包含法規字眼，或替換過程中破壞了 HTML tag）導致渲染破裂的痛點，我們採用**雙步 Token 替換法**：

1. **排序關鍵字**：將 `citedLaws`、`defendants`、`plaintiffs`、`judges` 的詞彙依照「字串長度由長到短」進行排序，防止短詞先替換進而破壞長詞。
2. **第一步（編碼為 Token）**：使用 RegEx 對判決全文進行比對，將匹配的實體名稱暫時替換成唯一的預留代碼（如 `___TOKEN_LAW_0___`、`___TOKEN_DEF_1___`）。
3. **分行處理**：將文字中的 `\r\n` 與 `\n` 全數轉為 `<br/>` 以利網頁換行渲染。
4. **第二步（解碼為 HTML）**：將所有的 Token 替換成對應的 HTML 語義高亮標籤。

#### 高亮樣式代碼：
* **法官 (Judge)**: `bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded border border-amber-200`
* **被告 (Defendant)**: `bg-rose-50 text-rose-700 font-bold px-1.5 py-0.5 rounded border border-rose-200`
* **原告 (Plaintiff)**: `bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-200`
* **法規 (Law)**: `bg-blue-50 text-blue-700 font-bold px-1.5 py-0.5 rounded border border-blue-200 hover:bg-blue-100 hover:text-blue-800 transition-colors cursor-pointer`

### 2.3 法條超連結
高亮後的法規標籤，其 HTML 將包裹為一個連結：
```html
<a href="https://law.moj.gov.tw/Search/SearchLawSingle.aspx?keyword=${encodeURIComponent(lawName)}" target="_blank" rel="noopener noreferrer">
  中華民國刑法第185-3條 🔗
</a>
```
這能讓使用者無縫跳轉到中華民國全國法規資料庫的檢索網頁。

---

## 3. 動畫與轉場效果設計

我們將採用 Tailwind CSS 4 的原生動效類別：
* **抽屜滑出與收回**：使用 `transition-all duration-300 ease-in-out`。
  * 關閉狀態：`translate-x-full opacity-0 pointer-events-none`
  * 開啟狀態：`translate-x-0 opacity-100 pointer-events-auto`
* **遮罩層 (Backdrop Overlay)**：抽屜開啟時，背景增加一層半透明毛玻璃遮罩：`bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300`，點選遮罩即可關閉抽屜。
* **骨架屏 (Skeleton Screens)**：使用帶有 `animate-pulse` 的灰色塊元件，取代原本的 Spinner 轉圈圈。包含：
  * 清單卡片骨架屏。
  * 全文閱讀器骨架屏。
