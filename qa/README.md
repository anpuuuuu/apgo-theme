# apgo.my 改动后的测试规则

推到 `main` 就直接上线，所以测试按「这次改动可能弄坏什么」来决定，不是每次全部测一遍。

- **每次都做**：第 0 级（推送前）＋上线后冒烟。
- **再按改动类型加做**：见下面的表。
- **修好一个 bug，就在 `regression.js` 加一项**，以后每次都会检查它有没有复发。
- 测试只用测试购物车，**不下单**；脚本会挡掉 FB/Google/TikTok 追踪和我们自己的错误监控，免得干扰广告数据和告警。

## 第 0 级：每次改代码都做

推送前：

1. `node qa/static.js`：所有 JSON 能解析、所有 JS 和 `{% javascript %}` 区块没有语法错误、Liquid 档没超过大小上限。
   （`{% javascript %}` 有一个语法错误，全站各区块的脚本都会一起坏掉，所以这项比看起来重要。）
2. `shopify theme check --path . --output json`：只看这次新增的 error。

推送后：

3. 确认 Shopify 有收到这次推送：用 Admin API 查 `files { updatedAt checksumMd5 }`，和本地档案比对。
   CSS 在线上会被压缩，别用 grep 注释来判断。没收到就 revert 再 reapply，推两次。
4. 冒烟：打开改到的页面，确认没有 JS 错误、版面正常、改动真的出现了。

## 按改动类型加做

| 改动类型 | 例子 | 加做 |
|---|---|---|
| 文案、图片、设定值 | 运送天数、banner 图、FAQ | 把所有出现的地方找齐：代码 grep，加上后台资料（运费名称、metaobject、FAQ）。MY 和 SG 各看一次。 |
| 单一区块版面 | 某个 section 的 CSS | 手机和电脑各截一张图。`devices.js` 挑 2–3 种装置跑。 |
| 全站、header、跑马灯、layout | `theme.liquid`、header、`settings_data.json` | `devices.js` 跑全部 9 种装置，`regression.js` 全跑。 |
| 购物车、限购、加购逻辑 | `cart-products.liquid`、`apgo-cc-pdp-picker.js` | `regression.js` R4–R7。把绕过的路径都想一遍：Buy again、旧购物车、结帐连结、直接打 API。再用 API 塞超量的数量实测一次。 |
| 价格、折扣、PWP、市场 | AIOD 折扣、市场设定、SG 限定商品 | MY 和 SG 都走到结帐页。符合条件和不符合条件各测一次。边界也要测：刚好达到、超过、把条件商品拿掉。 |
| 结帐、付款、运费 | 付款方式、运费表 | 查每种付款方式最近的成功和失败纪录。运费表要和 `snippets/apgo-shipping-estimate.liquid` 一致。隔天再看一次订单量和监控。 |
| 追踪、埋点 | GA4、Pixel | 测试时不要挡掉那一个追踪，确认事件真的有送出。隔天确认报表里有资料。 |

## 上线方式：小改动直接推，中大型先预览

- **小改动**（文案、单一区块、一两行的 bug 修正）：直接推 `main`，做第 0 级和表里对应的项目。
- **中大型改动**（新区块、改版、改购物车或结帐逻辑、全站样式）：先推到 `staging` 预览主题，测完再并入 `main`；上线后再跑一次 `regression.js`。

### staging 预览主题

- **一次性设定（店主在后台做）**：Shopify 后台 → 线上商店 → 主题 → 新增主题 → 从 GitHub 连接 → `anpuuuuu/apgo-theme`，分支选 `staging`。
  会多出一个**未发布**的主题，顾客看不到。
- **每次使用**：把 `staging` 重设成「`main` ＋这次改动」，推上去，等 Shopify 同步完，再跑
  `THEME_ID=<预览主题 id> node qa/regression.js`（`devices.js` 也一样用法）。
- `staging` 只拿来测，**不要在这个主题的编辑器里改东西**，下次重设就会被盖掉。
- 预览主题的设定（`settings_data.json`、templates 的 JSON）用的是 git 里的版本。正式主题在编辑器改过但还没同步回 git 的话，预览里会看到旧内容。

## 回归清单

自动（`node qa/regression.js`）：

| # | 检查 | 来源 | 什么时候删 |
|---|---|---|---|
| R1 | 手机往下滑后，跑马灯紧贴 header（首页、清仓页、All Products） | 867fa0e | — |
| R2 | 洗衣精页手机选单横排是米色底，字看得到 | 05d3a77 | — |
| R3 | iPad 768/820/1024 的 All Products 分类列不被切掉，整页不横向超出 | 05d3a77 | — |
| R4 | Pocket-Friendly 限购：每样 3，雨刷精 1 | f046843、4a091d9 | 活动结束 |
| R5 | 购物车超过限购（Buy again、旧购物车）会自动降回上限，并显示提示 | ac10bd2 | 活动结束 |
| R6 | SG PWP：有 Bundle 才有加购价（Shoe 300ml $5.90），拿掉 Bundle 恢复原价（$9.90） | 10/8 设定 | PWP 活动结束 |
| R7 | MY：购物车能进到结帐页（不下单） | — | — |
| R8 | SG 运送天数显示 3–5 天，没有旧的 5–7 天 | e7a68d1 | — |
| R9 | 清仓页对 SG 开放 | d5746d6 | — |

人工（脚本做不到，改到相关地方时要做）：

- **付款**：查 Fiuu（TNG/FPX）最近有没有成功的订单。10/1–10/3 曾整个停摆，修法是在 Fiuu App 按 Re-authorize。
- **运费**：后台运费一改，就要同步改 `snippets/apgo-shipping-estimate.liquid`。
- **掉图**：多个商品共用同一个图档时，删其中一个的图会让其他商品一起掉图。
- **Shopify 漏收推送**：见第 0 级第 3 步。

## 怎么跑

```bash
cd qa
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # 第一次
node static.js                                   # 第 0 级
node regression.js                               # 全部回归，或 node regression.js R5 R6
node devices.js                                  # 9 种装置，或 node devices.js iphone15-safari desktop-chrome
THEME_ID=123456 node regression.js               # 对 staging 预览主题跑
```

- 截图和结果在 `qa/out/`（不进 git）。
- `playwright` 固定在 1.62.0，对应这台电脑已经装好的 Chromium 和 WebKit（iPhone、iPad 用的 Safari 就是 WebKit）。升级 playwright 要一起装对应的浏览器。
- `qa/` 在 `.shopifyignore` 里，不会被同步到 Shopify 主题。

## 测不到的（回报时要写出来）

- 真机行为：iOS 的捲动、键盘、安全区域。FB/IG 内建浏览器只是换 UA 模拟，不是真的 app。
- Firefox（没装）。
- 付款：不下单，所以付款流程没有实测。
- 好不好看：脚本只抓得到坏掉，抓不到难看，截图还是要人看。

## 回报格式

每次改动后回报三件事：

1. 等级（小／中／大）和属于哪几类改动。
2. 跑了哪些测试，结果如何。
3. 没测到的部分（例如：付款没实测、只用模拟器、没测 Firefox）。
