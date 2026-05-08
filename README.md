# temptation-tracker
# 欲望博弈 Tracker

把"被动记录"翻转成"主动博弈"——每次冲动来袭就给欲望强度打分，
战胜得分、屈服扣分，循序渐进训练自控力。

## 文件结构
- `index.html` — 主页面
- `style.css` — 样式
- `app.js` — 前端逻辑
- `config.json` — 所有可调参数（清单、阈值、基线、加分系数）
- Apps Script 后端代码部署在 Google（不在本仓库）

## 评分公式

| 类别 | 战胜 | 屈服 |
|---|---|---|
| 离散诱惑 | +欲望值 | −欲望值 × 0.5 |
| 连续诱惑 | +欲望值 | (欲望值 − max(0, 实际−阈值)) × 0.5 |
| 连续奖励 | 超出基线按 rate/ratePer 加分，封顶 cap | — |
| 离散奖励 | 固定 +score/次 | — |

连续奖励是**增量计分**：每次记录都查当日累积，给"这次新增的得分"。

## 配置说明（config.json）
- `appsScriptUrl` — Google Apps Script Web App 部署 URL
- `secret` — 与后端 `SECRET` 完全一致的字符串
- `discreteTemptations / continuousTemptations / continuousRewards / discreteRewards` — 四类项目清单
- `scoring.*Multiplier` — 屈服扣分系数（默认 0.5）

改 config.json 后 push，刷新页面即生效（注意浏览器缓存，可强刷）。

## 后端（Google Apps Script）
- 脚本绑定到一个独立 Google Sheet
- Sheet 含两个工作表：`events`（每条记录一行）、`daily`（按日聚合，可选）
- 部署为"任何人可访问"的 Web App
- 安全：前端请求必须带 `secret`，否则返回 unauthorized

## 灾备 / 迁移
- 数据全在 Google Sheet 里，可随时手动改
- 换设备：直接打开 GitHub Pages URL，加到主屏幕
- 换仓库：fork/clone 后改 config.json 的两个字段即可
- 换 Sheet：在 Apps Script 改 `SHEET_ID` 后重新部署
