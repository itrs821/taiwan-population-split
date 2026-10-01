# 台灣人口分割線

在台灣本島地圖上畫一條直線，把人口切成兩半。拖曳線條可以平移，拖曳兩端的圓鈕可以旋轉；左側面板會即時顯示兩側的人口、面積和人口密度，以及這條線切過哪些縣市。

靈感來自英國的 [MapSplit](https://puntofisso.net/MapSplit/) 和胡煥庸線。

## 功能

- **左右平分／上下平分／此角度平分**：自動找出讓兩側人口相等的位置
- **找出台灣胡煥庸線**：搜尋所有角度與位置，找出「人口占比與面積占比差距最大」的直線
- **旋轉時保持人口平分**：轉動線條時自動平移，讓兩側人口維持 50:50
- 地圖依村里人口密度上色，滑鼠移到村里上會顯示名稱與人口
- 網址會記錄線的位置（例如 `#a=46.5&o=45.82`），可以直接分享

## 資料

| 項目 | 來源 |
|---|---|
| 村里人口 | 內政部戶政司開放資料 [ODRP014 村里戶數、單一年齡人口](https://www.ris.gov.tw/app/portal/346)（每月更新） |
| 村里界線 | 內政部 [村里界圖（TWD97經緯度）](https://data.gov.tw/dataset/7438)，使用 [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas) 的 TopoJSON 版本 |

只包含台灣本島：不含澎湖、金門、馬祖、綠島、蘭嶼、小琉球。

### 計算方式

- 座標先換算成以公里為單位的平面座標（以北緯 23.7° 為基準的等距投影），所以畫面上的角度就是實際的角度
- **人口**：每個村里的人口視為集中在村里重心；某個角度下的平分線，就是村里重心投影的「加權中位數」
- **面積**：沿分割線實際裁切村里多邊形後計算
- 界線資料（2021）與人口資料的村里代碼若對不上，會先用村里名稱比對；仍對不上的人口按面積分配給同鄉鎮內的村里

## 開發

需要 Node.js 18 以上。

```bash
npm install
npm run update   # 抓最新人口資料並重建 public/data/
npm run serve    # 本機預覽 http://localhost:8080
```

| 指令 | 說明 |
|---|---|
| `npm run fetch` | 從戶政司 API 抓最新月份的村里人口，存成 `data-raw/population-<民國年月>.csv` |
| `npm run build` | 合併界線與人口，輸出 `public/data/taiwan.topo.json` 和 `meta.json` |
| `node scripts/check.mjs` | 在終端機驗證平分線與胡煥庸線的計算結果 |

### 專案結構

```
public/             ← 網站本體（GitHub Pages 發佈這個資料夾）
  index.html
  css/style.css
  js/app.js         ← 地圖繪製與互動
  js/split.js       ← 分割線幾何與統計（純函式）
  js/model.js       ← TopoJSON 轉成計算用的資料結構
  data/             ← 建置產生的資料
scripts/            ← 資料抓取、建置、本機伺服器
data-raw/           ← 原始人口 CSV
.github/workflows/  ← 自動部署、每月更新資料
```

## 發佈到 GitHub Pages

1. 在 GitHub 建立新的 repository，然後推送：
   ```bash
   git remote add origin https://github.com/<你的帳號>/taiwan-population-split.git
   git push -u origin main
   ```
2. 到 repository 的 **Settings → Pages**，把 **Source** 設成 **GitHub Actions**
3. 等 Actions 跑完，網站就會出現在 `https://<你的帳號>.github.io/taiwan-population-split/`

`update-data.yml` 會在每月 20 日自動抓新資料並提交，也可以在 Actions 頁面手動執行。

## 授權

程式碼採 MIT 授權。資料依[政府資料開放授權條款－第1版](https://data.gov.tw/license)使用。
