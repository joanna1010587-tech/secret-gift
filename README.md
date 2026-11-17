# 交換禮物大會｜Secret Gift 🎁

一個可自行部署的開源交換禮物報名與抽籤工具。參加者從手機完成報名、修改資料與查看秘密任務；主辦人直接在 Google Sheets 管理活動、抽籤及公布結果。

> 適合朋友、同事等彼此信任的小型群組。系統以 Email 識別參加者，但不驗證 Email 所有權，不建議直接開放給不特定陌生人使用。詳見 [SECURITY.md](SECURITY.md)。

## 功能

- 手機優先的繁體中文報名頁面
- 自動產生不重複的參加編號
- 報名期間可用 Email 查詢與修改資料
- 隨機配對，保證不會抽到自己，且每人恰好送出、收到一份禮物
- 抽籤後先由主辦人核對，再決定何時公布
- Google Sheets 顯示送禮人／收禮人的編號與姓名
- 重置、刪除及清除資料前後的安全檢查與操作紀錄
- GitHub Pages 免費託管，資料保存在主辦人的 Google Sheet

## 架構

```text
參加者手機 → GitHub Pages 靜態網站
                    │
                    ▼
             Google Apps Script
                    │
                    ▼
               Google Sheets
                    ▲
                    │
               主辦人操作
```

網站沒有自己的資料庫、登入 session 或 Cookie。前端只開放五個動作：讀取活動資訊、報名、查詢報名、修改報名及查詢自己的抽籤任務。抽籤、公布、刪除與清除只能從主辦人的 Google Sheet 選單執行。

## 快速部署

### 1. Fork 或下載專案

按 GitHub 頁面右上角的 **Fork**，或下載 ZIP。若使用 Fork，請在自己的 repository 設定 GitHub Pages。

### 2. 建立 Google Sheet 與 Apps Script

1. 在 Google Drive 新增一份 Google 試算表。
2. 打開「擴充功能 → Apps Script」。
3. 用 [`gas/Code.gs`](gas/Code.gs) 的完整內容取代編輯器中的 `Code.gs`。
4. 在 Apps Script 左側「專案設定」勾選顯示 `appsscript.json`，再用 [`gas/appsscript.json`](gas/appsscript.json) 的內容取代它。
5. 儲存後，在函式選單選擇 `setupSheets` 並按「執行」。第一次執行會要求授權。
6. 回到試算表重新整理。你會看到「活動設定」、「參加名單」、「抽籤結果」及「操作紀錄」，上方也會出現「🎁 交換禮物管理」選單。

### 3. 設定活動

在「活動設定」工作表修改：

| field | 用途 |
|---|---|
| `event_name` | 活動名稱 |
| `event_date` | 活動日期，格式 `YYYY-MM-DD` |
| `budget_min` / `budget_max` | 禮物預算範圍 |
| `registration_deadline` | 報名截止時間，格式 `YYYY-MM-DD HH:mm`，預設台灣時區 |
| `status` | 初次開放時使用 `REGISTRATION_OPEN` |

`draw_id`、`draw_timestamp` 及 `next_participant_no` 由系統維護，請勿手動修改。

### 4. 部署 Apps Script

1. Apps Script 右上角選「部署 → 新增部署作業」。
2. 類型選「網頁應用程式」。
3. 執行身分選「我」，誰可以存取選「所有人」。
4. 部署後複製結尾為 `/exec` 的網址。
5. 打開「`你的網址?action=ping`」，若看到 `{"success":true,"data":{"pong":true}}` 即部署成功。

### 5. 連接前端

編輯 [`config.js`](config.js)，填入自己的 `/exec` 網址：

```js
window.SG_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/你的部署代碼/exec'
};
```

這個網址不是密碼，可以放在公開的靜態網站中；但請確認它連到你自己的 Apps Script，不要沿用別人的部署。

### 6. 啟用 GitHub Pages

1. Repository 必須是 **Public**，除非你的 GitHub 方案支援私人 Pages。
2. 到「Settings → Pages」。
3. Source 選「Deploy from a branch」。
4. Branch 選 `main`，目錄選 `/ (root)`，再按 Save。
5. 等待部署完成，網址通常是 `https://你的帳號.github.io/你的專案/`。

如果要讓 LINE 正確顯示分享圖，請把 [`index.html`](index.html) 中 `og:image` 改成 `assets/og-image.png` 的完整公開網址。

## 正式開放前測試

1. 從網站新增一筆測試報名，確認「參加名單」出現 `No.001`。
2. 用同一個 Email 查詢並修改資料，確認 Sheet 同步更新。
3. 至少新增兩位測試者，將活動狀態改成 `REGISTRATION_CLOSED`。
4. 從「🎁 交換禮物管理」產生抽籤，確認每人都沒有抽到自己。
5. 重置抽籤後，使用「清除全部測試資料」；確認名單清空、下一個編號回到 `No.001`。
6. 將狀態改回 `REGISTRATION_OPEN`，再分享活動網址。

## 主辦人操作

| 需求 | 操作方式 |
|---|---|
| 提前關閉報名 | 將 `status` 改成 `REGISTRATION_CLOSED` |
| 延長報名 | 修改 `registration_deadline`，並將狀態改回 `REGISTRATION_OPEN` |
| 抽籤 | 關閉報名後，選「🎁 交換禮物管理 → 產生抽籤結果」 |
| 核對結果 | 查看「抽籤結果」前六欄的姓名、編號、形容詞與配對時間 |
| 公布結果 | 選「公布抽籤結果」；公布前參加者看不到任務 |
| 重抽 | 公布前選「重置抽籤結果」，再重新產生抽籤 |
| 刪除參加者 | 點選「參加名單」中的資料列，再選「刪除選取的參加者」 |
| 清空測試資料 | 選「清除全部測試資料」，依畫面提示確認 |
| 活動結束 | 將 `status` 改成 `COMPLETED`，參加者仍可查詢任務 |

狀態流程：

```text
REGISTRATION_OPEN → REGISTRATION_CLOSED → DRAW_READY → DRAW_PUBLISHED → COMPLETED
```

## 修改 Apps Script 後重新部署

只在編輯器按「儲存」不會更新正式服務。請打開「部署 → 管理部署作業 → 編輯」，版本選「新版本」後再次部署。原本的 `/exec` 網址不會改變。

## 本機開發

需要 Node.js 18 以上，不需安裝額外套件。

```bash
npm test
npm run dev
```

網站會開在 `http://localhost:8787`。本機後端使用記憶體模擬 Google Sheets，關閉後資料即消失。

可用下列指令模擬主辦人操作：

```bash
curl -X POST localhost:8787/__admin \
  -H 'Content-Type: application/json' \
  -d '{"op":"status","value":"REGISTRATION_CLOSED"}'
```

`op` 也支援 `draw`、`publish`、`reset`、`clear` 及 `dump`。這些開發用路由只存在於本機伺服器，不會部署到 GitHub Pages 或 Apps Script。

## 已知限制

- Email 是識別碼，不會寄送驗證信或一次性密碼。
- 沒有 CAPTCHA 或公開網路的濫用防護。
- Apps Script 閒置後的第一次呼叫可能需要數秒。
- 免費服務有使用量配額，適合小型活動，不適合作為大型商業平台。
- 介面目前以繁體中文及手機版為主。

## 授權

本專案採用 [MIT License](LICENSE)。你可以使用、修改與散布，但請自行確認活動資料與參加者隱私的處理方式。
