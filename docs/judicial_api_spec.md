# 司法院裁判書開放 API 規格說明文件 (judicial_api_spec.md)

本文件整理自司法院 114.08.22 釋出之「司法院裁判書開放 API 規格說明」，用於提供 AI 協同開發助手與開發人員理解、串接及同步司法院裁判書異動與全文資料之用。

---

## 1. 服務主機與一般限制

* **API 類型**：RESTful API
* **資料格式**：JSON 格式
* **服務時間限制**：
  > [!IMPORTANT]
  > 因考慮網路頻寬及系統負擔，**本 API 僅於每日凌晨 0:00 至 6:00（台灣時間）開放服務**。其餘時間恕不提供服務。
* **文件或 PDF 下載**：若裁判書有附件，或裁判書全文以 PDF 形式儲存，API 將回傳可下載該檔案的 URL。

---

## 2. API 介面規格

### 2.1 驗證取得 Token (Auth)
驗證使用者帳密是否具備讀取本開放 API 之權限，並回傳一組臨時的 Access Token。

* **服務路徑**：`POST https://data.judicial.gov.tw/jdg/api/Auth`
* **Content-Type**：`application/json`
* **輸入參數 (Request Body)**：
  ```json
  {
    "user": "您的開放平台帳號",
    "password": "您的開放平台密碼"
  }
  ```
* **輸出回應 (Response)**：
  * **驗證通過**（回傳 Token，**有效期限為驗證通過後 6 小時**）：
    ```json
    {
      "Token": "ddf8bb4f32f746bdb5510c1eed76db51"
    }
    ```
  * **驗證失敗**：
    ```json
    {
      "error": "驗證失敗"
    }
    ```

---

### 2.2 取得裁判書異動清單 (JList)
依據呼叫 API 的當日日期，提供 **7 日前**有發生異動的裁判書 ID (jid) 列表。例如在 2017/10/16 呼叫此 API，系統會回傳 2017/10/9 發生異動的裁判書 ID 清單。

* **服務路徑**：`POST https://data.judicial.gov.tw/jdg/api/JList`
* **Content-Type**：`application/json`
* **輸入參數 (Request Body)**：
  ```json
  {
    "token": "ddf8bb4f32f746bdb5510c1eed76db51"
  }
  ```
* **輸出回應 (Response)**：
  回傳每日異動清單的陣列，每個項目包含異動日期與當天異動的 JID 陣列：
  ```json
  [
    {
      "date": "2016-12-23",
      "list": [
        "CDEV,105,橋司附民移調,101,20161219,1",
        "CDEV,105,橋司附民移調,95,20161219,1",
        "CDEV,105,橋司附民移調,98,20161219,1"
      ]
    }
  ]
  ```
* **備註**：若 Token 驗證有誤，將回傳 `{"error": "驗證失敗"}`。

---

### 2.3 取得個別裁判書全文與詳情 (JDoc)
依據所輸入的 `jid`，提供該筆裁判書的完整內容與 Metadata。

* **服務路徑**：`POST https://data.judicial.gov.tw/jdg/api/JDoc`
* **Content-Type**：`application/json`
* **輸入參數 (Request Body)**：
  ```json
  {
    "token": "ddf8bb4f32f746bdb5510c1eed76db51",
    "j": "CHDM,105,交訴,51,20161216,1"
  }
  ```
* **輸出回應 (Response)**：
  * **成功取得內容（範例一：全文內容為 text）**：
    ```json
    {
      "ATTACHMENTS": [
        {
          "TITLE": "附表三.pdf",
          "URL": "https://data.judicial.gov.tw/jdg/api/JFile/..."
        }
      ],
      "JFULLX": {
        "JFULLTYPE": "text",
        "JFULLCONTENT": "臺灣彰化地方法院刑事判決\n 100年度訴字第1552號\n公訴人...",
        "JFULLPDF": ""
      },
      "JID": "CHDM,100,訴,1552,20130517,2",
      "JYEAR": "100",
      "JCASE": "訴",
      "JNO": "1552",
      "JDATE": "20130517",
      "JTITLE": "偽造文書等"
    }
    ```
  * **成功取得內容（範例二：全文內容為檔案 PDF）**：
    若 `JFULLTYPE` 為 `file`，則 `JFULLCONTENT` 通常為摘要文字，而完整的 PDF 下載連結會提供在 `JFULLPDF` 欄位中。
    ```json
    {
      "ATTACHMENTS": [],
      "JFULLX": {
        "JFULLTYPE": "file",
        "JFULLCONTENT": "臺灣高等法院刑事裁定\n110年度毒抗字...",
        "JFULLPDF": "https://data.judicial.gov.tw/jdg/api/JDocFile/TPHM/110%2c毒抗%2c1212%2c20210831%2c1.pdf"
      },
      "JID": "TPHM,110,毒抗,1212,20210831,1",
      "JYEAR": "110",
      "JCASE": "毒抗",
      "JNO": "1212",
      "JDATE": "20210831",
      "JTITLE": "毒品危害防制條例"
    }
    ```

---

## 3. 異動與刪除遵循規則 (重要)

因裁判書上傳後仍可能有所異動或依法規撤回，開發與資料庫同步系統時，必須嚴格遵守以下兩點異動規則：

1. **🔄 內容覆蓋規則**：
   `jid` 是裁判書的 Primary Key。如果同一個 `jid` 出現在不同日期的異動清單中，代表裁判內容有修正。系統必須以**最新的下載內容覆蓋先前取得的內容**。
2. **🗑️ 隱私與不公開撤案刪除規則 (GDPR Compliance)**：
   若呼叫 `JDoc` 時，系統回傳以下 error message：
   ```json
   {
     "error": "查無資料，本裁判可能未公開或已從系統移除，若您曾經下載過本裁判，亦請您將其移除！謝謝！"
   }
   ```
   這代表本案已被依法移除或撤銷公開。使用者與同步系統**必須立刻從本地庫（如 Neo4j、PostgreSQL）中將該筆裁判書的節點與關係刪除**，以免損害當事人隱私與權益。
