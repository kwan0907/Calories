# 蟹帳 Crab POS

這個 repository 現在已改為獨立的賣蟹 POS / 訂單 / 客戶 / 成本 / 支出 / 送貨 / 投資者查帳系統。

## 隔離資源

- Worker: `crab-pos`
- D1: `crab-pos-db`
- Session cookie: `crab_pos_session`
- D1 binding: `DB`

不會讀取或修改其他 Cloudflare Worker、D1、Supabase 或其他專案資料。

## 主要功能

- Admin / Investor 分權登入
- Investor 後端 API 不回傳客戶姓名、電話、完整地址
- POS 快速開單，可手動輸入訂單編號
- 九指蟹公 / 爆膏蟹公 / 濃香蟹母預設產品
- 產品分類、售價、成本、庫存、成本歷史
- 客戶資料及購買紀錄
- 訂單、送貨、付款、備註
- 自動計算成本、營業額、毛利、淨利、未收款
- 支出管理
- 投資者比例及估算應佔利潤
- Audit Log
- CSV 匯出
- PWA 手機介面

## Cloudflare 後端部署

```bash
npm install
npx wrangler login
npx wrangler d1 create crab-pos-db --location apac
```

把得到的 D1 `database_id` 填入 `wrangler.jsonc`，然後：

```bash
npx wrangler d1 migrations apply crab-pos-db --remote
npx wrangler secret put SETUP_KEY
npx wrangler deploy
```

第一次開啟 Cloudflare Worker 網址會顯示首次設定，建立第一個 Admin。

## Netlify

此 repo 已加入 `netlify.toml`，Netlify 可直接 publish `public`。

注意：POS 的雲端 API / D1 後端仍由 Cloudflare Worker 提供；如果只部署靜態前端到 Netlify，API 必須另外指向已部署的 Cloudflare Worker。
