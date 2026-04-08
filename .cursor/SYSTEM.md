# APGO Theme System 總覽（給新 Agent 的快速理解）

## 1. 專案是什麼

- **類型**：Shopify Online Store 2.0 主題
- **品牌**：APGO（鍍膜／汽車護理）
- **語系**：繁中 (zh-TW) + 英文 (en)，部分區塊有 Eng 版本
- **Repo**：`https://github.com/anpuuuuu/apgo-theme.git`，主分支 `main`

---

## 2. 技術與結構

| 項目 | 說明 |
|------|------|
| **主題結構** | 標準 Shopify 2.0：`layout/`、`sections/`、`snippets/`、`templates/`、`assets/`、`config/`、`blocks/` |
| **頁面組成** | 由 `templates/*.json` 決定各頁的 sections 與順序；首頁 = `templates/index.json`（很大，多個 custom-liquid） |
| **Shogun** | 有整合 Shogun（`shogun-head`、`shogun-content-handler`、`page.shogun.*`），部分頁面/區塊可能由 Shogun 輸出 |
| **自訂區塊** | 大量使用 **custom-liquid** section：內嵌完整 HTML/CSS/JS，區塊名稱如「Homepage S2」「Homepage S2 Eng」「Homepage S3 Eng」等 |

---

## 3. 首頁 (index.json) 與影片區塊

- **Section 順序**：`marquee` → `section_NcGDMK` → 多個 `custom_liquid_*`（含 S2、S2 Eng、S3 Eng…）。
- **影片區塊**：
  - **Homepage S2**：`custom_liquid_fw79UU`（繁中品牌影片）
  - **Homepage S2 Eng**：`custom_liquid_afAH4y`（英文品牌影片）
  - 其他區塊（如 S3 Eng）可能也有自己的影片。
- **重要**：同一頁會有多個「品牌影片」區塊，若都用同一個 `id="brandVideo"`，`getElementById('brandVideo')` 只會拿到第一個，導致其他區塊的 controller 控制錯影片、loading 不消失。
- **已做修正**：Homepage S2 Eng 使用**獨立 ID**（`brandVideoS2Eng`、`particleCanvasS2Eng`、`loadingRingS2Eng`、`playControlS2Eng`、`progressBarS2Eng`、`statusIndicatorS2Eng`、section `id="cinematicSectionS2Eng"`），避免與 S2 / S3 衝突。
- **修改首頁影片區塊**：需改 `templates/index.json` 裡對應 section 的 `custom_liquid` 字串（整段 HTML）；必要時用 Node 腳本讀取 JSON、替換字串、再寫回。

---

## 4. 已做的客製化（方便延續與除錯）

| 功能 | 檔案／位置 | 說明 |
|------|------------|------|
| **Space 鍵不觸發捲動／搶焦** | `assets/utilities.js` | `ensureSpaceGuard()`：在輸入框、Chat（App Embed）等處攔截 Space，避免捲到影片；`layout/theme.liquid` 對 `#brandVideo` 做 blur（僅影響「第一個」brandVideo）。 |
| **Footer 連結 hover** | `sections/APGO-footer.liquid` | 預設灰，hover 時文字與底線為橙色 `#f08418`。 |
| **Header 主選單 hover** | `blocks/_header-menu.liquid` | `.menu-list__link` hover 時橙色＋底線。 |
| **Collection 次級選單（橫向分類）** | `blocks/_collection-link.liquid` | 不是 header mega menu，而是 **collection 頁**的 collection-links 區塊；`.collection-links__link` 當前頁用 `aria-current`（由 section 傳入的 `selected`），其餘 hover 時橙色＋底線。 |
| **自動推送** | `.cursor/rules/auto-push.mdc` | 完成程式碼修改後自動 `git add`、`commit`、`push origin main`。 |

---

## 5. 品牌影片區塊（Homepage S2 Eng）邏輯與除錯重點

- **內容**：整段在 `templates/index.json` → `sections.custom_liquid_afAH4y.settings.custom_liquid`，內含：
  - HTML：`.cinematic-video-section`、`.video-stage`、`.ambient-glow`、粒子、loading、播放按鈕、進度條等
  - CSS：獨立 namespace，容器 `height: auto`、`padding: 4vh 0` 以顯示光暈
  - JS：`CinematicVideoController`（IntersectionObserver 自動播放、事件、parallax、Space 阻擋）
- **曾修過的 Bug**：
  1. `volumeHint.style.cssText = position: absolute; ...` 未加引號 → 改為字串
  2. `section.style.transform = translateY(${rate}px)` 錯誤 → 改為 `'translateY(' + rate + 'px)'`
  3. `preload="metadata"` 導致 `loadeddata` 不觸發、loading 不消失 → `preload="auto"` 並加 `loadedmetadata` 隱藏 loading
  4. 多區塊共用 `id="brandVideo"` → S2 Eng 改為專用 ID（見上表）
- **若仍卡 loading／不顯示影片**：可檢查 (1) 該區塊的 script 是否綁到正確的 `brandVideoS2Eng`／`loadingRingS2Eng`；(2) 影片 URL 是否有效、CORS／權限；(3) 是否有其他 JS 錯誤導致 controller 未建立。

---

## 6. 修改 index.json 的實務

- 檔案很大、且為 JSON，直接手改易錯；建議用 **Node 腳本**：
  - 讀取 `templates/index.json`
  - 若有註解，先去掉再 `JSON.parse`
  - 改 `j.sections.custom_liquid_afAH4y.settings.custom_liquid`（或目標 section）的字串
  - `JSON.stringify(j, null, 2)` 寫回，可保留頂部註解
- 替換時注意：內容是**已跳脫的字串**（如 `\"`），替換用字串要與實際一致（例如空格、換行在 minified 時可能變成空格）。

---

## 7. 常用檔案路徑

```
layout/theme.liquid          # 主 layout，含 brandVideo blur、Shogun
sections/custom-liquid.liquid # 僅輸出 section.settings.custom_liquid
sections/APGO-footer.liquid  # Footer 連結樣式
sections/collection-links.liquid # collection 頁橫向分類
blocks/_header-menu.liquid   # 主選單、mega menu
blocks/_collection-link.liquid # 次級分類連結樣式（collection 頁）
assets/utilities.js         # Space 守衛
templates/index.json        # 首頁 section 順序與各 custom_liquid 內容
templates/collection.json   # 集合頁（含 collection_links）
.cursor/rules/auto-push.mdc # 自動 git push 規則
```

---

## 8. Git 與協作

- **遠端**：`origin` → `https://github.com/anpuuuuu/apgo-theme.git`
- **分支**：`main`
- **規則**：依 `.cursor/rules/auto-push.mdc`，改完碼後由 agent 執行 add / commit / push，無需再問。
- **Commit message**：簡潔中英文皆可，例如 `fix: ...`、`style: ...`、`feat: ...`。

---

## 9. 給新 Agent 的檢查清單

1. **改的是哪一層**：Header 選單 → `_header-menu.liquid`；Collection 頁橫向分類 → `_collection-link.liquid`；首頁某塊影片 → `index.json` 對應的 custom_liquid。
2. **影片／loading 問題**：先確認是否為 ID 衝突（多個 `brandVideo`）；S2 Eng 必須用 `brandVideoS2Eng` 等專用 ID。
3. **改 index.json**：用腳本改，避免破壞 JSON 結構與跳脫。
4. **完成後**：依 auto-push 規則執行 git add、commit、push。
