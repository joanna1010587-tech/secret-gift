# Secret Gift｜H組聖誕趴－交換禮物大會

留下一個形容詞，換一份驚喜。

```
參加者的手機 ──> GitHub Pages（這個資料夾的網站）
                    │  POST（只有 5 個公開功能）
                    ▼
               Google Apps Script 網頁應用程式（gas/Code.gs）
                    │
                    ▼
               Google Sheets（報名、配對、操作紀錄）
                    ▲
主辦人 ─────────────┘  試算表上方選單「🎁 交換禮物管理」
```

- **前台**：純靜態網站（HTML／CSS／JS，不需要編譯），放在 GitHub Pages。
- **後台**：Google Apps Script，資料全部寫進 Google Sheets。
- **主辦人**：直接在 Google Sheets 操作，不需要另外的管理網站。

## 為什麼不會「登入失效」

- 網站沒有登入、沒有 session、也沒有 cookie。每次查詢都只用 Email 去 Google Sheets 查，所以不會過期。
- Apps Script 部署成「所有人」都能存取，參加者**不需要 Google 帳號**，也不會跳出 Google 登入畫面。
- 前台放在 GitHub Pages，網址固定、不會過期。手機上同時登入多個 Google 帳號時常見的錯誤（Apps Script 網頁的老問題），在這個架構下也不會發生。

---

## 一、部署（第一次大約 15 分鐘）

### 1. 建立 Google Sheet 與 Apps Script

1. 到 Google 雲端硬碟新增一份 Google 試算表，命名為「Secret Gift 2026」。
2. 上方選單「擴充功能 → Apps Script」。
3. 把編輯器裡原本的 `Code.gs` 內容全部刪掉，貼上本資料夾 `gas/Code.gs` 的全部內容，按儲存。
4. 左側「專案設定（齒輪）」→ 勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」→ 回到編輯器，打開 `appsscript.json`，用本資料夾 `gas/appsscript.json` 的內容取代，按儲存。（時區設為台灣、網頁應用程式設為「所有人」。）
5. 上方函式下拉選單選 `setupSheets` → 按「執行」。第一次會要求授權：選你的帳號 →「進階」→「前往（不安全）」→「允許」。
6. 回到試算表重新整理，會看到 `活動設定`、`參加名單`、`抽籤結果`、`操作紀錄` 四個工作表，上方多了「🎁 交換禮物管理」選單。

### 2. 確認活動設定

打開 `活動設定` 工作表，檢查 `value` 欄：

| field | 預設值 | 說明 |
|---|---|---|
| event_name | H組聖誕趴－交換禮物大會 | 活動名稱 |
| event_date | 2026-12-18 | 活動日期 |
| budget_min / budget_max | 500 / 600 | 禮物預算 |
| registration_deadline | 2026-11-24 23:59 | **報名截止（台灣時間），PRD 要求上線前由主辦人確認時分** |
| status | REGISTRATION_OPEN | 活動狀態（下拉選單） |

`draw_id`、`draw_timestamp`、`next_participant_no` 由系統維護，請不要手動修改。

### 3. 部署成網頁應用程式

1. Apps Script 編輯器右上角「部署 → 新增部署作業」。
2. 類型選「網頁應用程式」。
3. 執行身分：**我**；誰可以存取：**所有人**（不要選「擁有 Google 帳戶的任何人」，否則參加者會被要求登入）。
4. 按「部署」，複製網址（結尾是 `/exec`）。
5. 在瀏覽器打開「網址 + `?action=ping`」，看到 `{"success":true,"data":{"pong":true}}` 就成功了。

### 4. 把網址填進網站

打開本資料夾的 `config.js`，貼上剛剛的網址：

```js
window.SG_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/xxxxxxxx/exec'
};
```

### 5. 放上 GitHub Pages

1. 在 GitHub 建立新的 repository（例如 `secret-gift`）。免費帳號要使用 GitHub Pages，repository 需要設為 **Public**。
2. 把本資料夾的所有檔案上傳到 repository 的 `main` 分支（網頁上可以直接拖拉上傳）。
3. repository 的「Settings → Pages」→ Source 選「Deploy from a branch」→ Branch 選 `main`、資料夾 `/ (root)` → Save。
4. 約 1 分鐘後網站就會出現在 `https://你的帳號.github.io/secret-gift/`。

> Repository 公開不會洩漏資料：程式裡沒有任何密碼或金鑰，報名資料只存在你的 Google Sheets。

### 6. 正式開放前的端到端測試（PRD 3.2 要求）

1. 用網站報名一筆測試資料 → 確認 `參加名單` 立刻出現一列、編號 No.001。
2. 用同一個 Email 到「查看／修改報名」查詢 → 修改形容詞 → 確認 Sheets 有更新。
3. 用「🎁 交換禮物管理 → 清除全部測試資料」清空，網站回到報名中、編號從 No.001 重新開始。

### 之後如果修改了 Code.gs

Apps Script 修改後**一定要發布新版本**，網站才會用到新程式：
「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本：新版本 → 部署」。網址不會改變，`config.js` 不用動。

---

## 二、主辦人操作說明

### 活動流程

```
REGISTRATION_OPEN ──> REGISTRATION_CLOSED ──> DRAW_READY ──> DRAW_PUBLISHED ──> COMPLETED
   報名中（P01–P05）     報名截止（P06）        已抽籤未公布（P06）  任務已公布（P07–P09）  活動結束（仍可查任務）
```

| 我想要… | 怎麼做 |
|---|---|
| 提前關閉報名 | `活動設定` 的 `status` 改成 `REGISTRATION_CLOSED` |
| 延長報名 | 修改 `registration_deadline`，`status` 維持（或改回）`REGISTRATION_OPEN` |
| 抽籤 | 選單「產生抽籤結果」。需要先關閉報名（或已過截止時間）、至少 2 人。抽完狀態變成 `DRAW_READY`，**還不會公布** |
| 確認抽籤結果 | 看 `抽籤結果`：前六欄直接顯示「送禮人編號／姓名 → 收禮人編號／姓名」、收禮人寫的形容詞與配對時間。系統 ID 保留在隱藏欄位供程式核對，不需要人工對照 |
| 公布 | 選單「公布抽籤結果」。系統會再檢查一次配對完整性，通過後參加者才看得到任務 |
| 重抽（未公布前） | 選單「重置抽籤結果」→ 再「產生抽籤結果」。報名資料不受影響 |
| 刪除某位參加者 | 在 `參加名單` 點選那一列 → 選單「刪除選取的參加者」。資料會標記為 `DELETED`（不真的移除），他的 Email 可以重新報名，其他人的編號不變。已抽籤時要先重置；公布後不能刪除 |
| 清空測試資料 | 選單「清除全部測試資料」，輸入「清除」確認。活動設定會保留，編號從 No.001 重新開始。公布後不能使用 |
| 活動結束 | `status` 改成 `COMPLETED`，參加者仍然可以查詢自己的任務 |

### 安全網

- **自動備份**：重置與清除前，會先把資料複製到隱藏工作表「備份_…」。需要時在試算表下方工作表列表右鍵「顯示工作表」即可找回。
- **操作紀錄**：抽籤、公布、重置、刪除、清除（含失敗）都會記在 `操作紀錄`。
- **抽籤後的提醒**：抽籤後 `參加名單` 與 `抽籤結果` 會加上「編輯前警告」，避免不小心改到形容詞。如果真的改了，「公布」時系統會擋下並告訴你哪一位不一致。
- **同時報名**：報名與修改都用 LockService 排隊處理，同一個 Email 不會被建立兩次。

### 參加者忘記 Email

在 `參加名單` 用名字搜尋（Ctrl/⌘ + F），把 Email 告訴他即可。

---

## 三、本機預覽與測試（給開發者）

需要 Node.js 18 以上，不用安裝任何套件。

```bash
npm test
```

```bash
npm run dev
```

`npm test` 會在模擬的 Google Sheets 上跑 30 項後端測試（報名、查重、截止、抽籤、公布、刪除、重置、清除、資料不外洩）。
`npm run dev` 會在 http://localhost:8787 開啟網站，後端執行的就是 `gas/Code.gs` 本身（資料存在記憶體，重開就清空）。本機可以用下面的指令模擬主辦人操作：

```bash
curl -X POST localhost:8787/__admin -d '{"op":"status","value":"REGISTRATION_CLOSED"}'
```

`op` 也可以是 `draw`、`publish`、`reset`、`clear`、`dump`。

---

## 四、已知限制

- **只用 Email 查詢**：沒有驗證 Email 所有權，知道別人 Email 的人可以查看他的任務、或在報名期間修改他的資料。這是 PRD 11.2 已接受的簡化設計。
- **第一次載入稍慢**：Apps Script 閒置一陣子後第一次被呼叫，需要 2–5 秒啟動，網站會顯示「資料處理中，請稍候」。
- **使用量**：Apps Script 的免費額度對朋友間的活動綽綽有餘；同一時間很多人送出時會排隊處理，最多等幾秒。
- **電腦版**：沿用手機版版面，置中顯示。

## 檔案結構

```
index.html            網站入口
config.js             ← 唯一需要修改的設定（Apps Script 網址）
assets/css/style.css  視覺樣式
assets/js/buddy.js    五位角色的 SVG
assets/js/api.js      呼叫 Apps Script
assets/js/app.js      P01–P09 頁面與流程
gas/Code.gs           Apps Script 後端（貼到 Google Sheets）
gas/appsscript.json   Apps Script 設定
tests/                後端自動測試
dev/                  本機預覽伺服器與 Google Sheets 模擬
docs/UAT.md           驗收紀錄
```
