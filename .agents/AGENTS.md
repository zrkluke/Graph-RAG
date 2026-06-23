# AI Agent Workspace Rules (.agents/AGENTS.md)

## 1. 提案與實作計畫雙向同步規範
當啟動任何 API 實作、圖譜解析、腳本修改或重大重構任務時，AI 助理必須嚴格遵循雙向規劃流程：

1. **平台專用審查**：
   * 在平台指定的路徑（如 `<appDataDir>\brain\<conversation-id>/implementation_plan.md`）建立實作計畫，以利平台 UI 介面呈現「核准與同意」按鈕。
2. **專案規格規格化 (OpenSpec)**：
   * 在專案的 `openspec/changes/<change-name>/` 下建立對應的 `proposal.md`、`design.md` 與 `tasks.md`。
   * 將重構的長期架構影響同步更新回 `openspec/project.md` 中。
3. **臨時檔案清理**：
   * 任務執行完成且通過靜態類型編譯檢查後，應將任何在專案根目錄下生成的臨時進度追蹤檔案（如 `task.md`）徹底刪除，進度狀態統一交由 OpenSpec 歸檔管理。
