## ADDED Requirements

### Requirement: React 側邊欄與分頁 Tabs 佈局
系統 SHALL 實作 React 佈局，左側提供案情描述、法院與案件種類下拉式過濾器配置，右側提供「相似判決卡片」與「關聯圖譜網絡」的 Tabs 分頁。

#### Scenario: 使用者切換分頁視圖
- **WHEN** 使用者點選「關聯圖譜網絡」分頁標籤
- **THEN** 前端將右側內容平滑切換為網絡圖畫布，且不觸發重複的後端 API 請求

### Requirement: 核心法條統計儀表板
系統 SHALL 在搜尋結果頂部，依據召回判決書引用的法條進行次數統計，以高質感 HSL 漸層卡片渲染 Top 3 關聯法規。

#### Scenario: 即時統計並呈現 Top 3 法規
- **WHEN** 搜尋 API 回傳包含 `citedLaws` 的判決書陣列
- **THEN** 前端自動計算各法條出現頻率，並於儀表板呈現例如：`中華民國刑法第185-3條 (3次)` 的標記

### Requirement: Web 端 vis-network 互動圖譜
系統 SHALL 利用 `vis-network` npm 套件於瀏覽器端 Canvas 渲染互動式網絡圖。節點配色規範為：中心查詢為藍色，判決書為橘色，法規為黃色，法官為紫色，當事人為紅色與綠色。

#### Scenario: 互動網絡圖載入與操作
- **WHEN** 使用者在圖譜畫布上進行拖拽節點、滾輪縮放或滑鼠懸停 (hover)
- **THEN** 圖譜平滑響應操作，並於懸停時浮現含有法院、字號、案由及相似度得分的資訊提示窗 (Tooltip)
