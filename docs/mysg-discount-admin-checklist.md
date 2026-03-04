# MY/SG 真实免运后台配置清单

本文件用于在 Shopify Admin 配置「真实免运费」规则，确保 checkout 会按实际运费减免，而不是前端假计算。

## 1) Shipping Profiles（必须先确认）

- 确认 MY 与 SG 都有可用配送方式与费率（Standard/Express 等）。
- 免运是“把本次订单实际命中的运费折抵为 0”，所以基础费率仍需先正确存在。

## 2) Discount（运费折扣）

- 类型：`Shipping discount`（不是 Product/Order 折扣）。
- 适用市场与门槛：
  - MY：订单金额满 `100 MYR` 免运。
  - SG：订单金额满 `79 SGD` 免运。
- 建议做法：
  - 若后台可按市场 + 本币门槛分别建两条自动运费折扣，直接拆成两条（MY 一条、SG 一条）。
  - 若后台限制导致无法精准表达，使用 Shopify Functions 做 market-aware shipping discount。

## 3) Markets 与货币

- 确认 MY Market 结账币别为 MYR，SG Market 为 SGD。
- 确认价格显示与结账币别一致，避免门槛币别误判。

## 4) 与主题前端的对应关系

- 首页 Marquee 文案：
  - MY 用户看到：满 100 MYR 免运。
  - SG 用户看到：满 79 SGD 免运。
- 购物车进度条只用于提示门槛，不负责实际减免金额。
- 真实免运以 checkout 命中的 Shipping discount 为准。

## 5) 上线前回归（必测）

- MY 市场：
  - 小计 `< 100`：结账仍有运费。
  - 小计 `>= 100`：结账运费为 0。
- SG 市场：
  - 小计 `< 79`：结账仍有运费。
  - 小计 `>= 79`：结账运费为 0。
- 地址必填拦截：
  - 购物车未填完整 `Country/Province/City/ZIP/Address1` 不可进入 checkout。
  - 填写完整后可进入 checkout，地址自动预填。
