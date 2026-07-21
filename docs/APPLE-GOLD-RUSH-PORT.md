# SnpRush 对照 apple-gold-rush 改造说明

> 对齐目标：提高 **数据准确性**、**预测可靠性**、**日报可读性**。  
> 参考仓库：`371684029/apple-gold-rush`（黄金理财助手）。

## 一比一对照（已落地）

| 能力 | apple-gold-rush | SnpRush（本轮） |
|------|-----------------|-----------------|
| 拒零入库 / Zod | `schemas/market.ts` | ✅ 同构，字段改为 SPX/IXIC/SPY/QQQ/VIX |
| 非 LLM 锚定 | gold-api / 新浪 / Yahoo GC=F | ✅ Yahoo `^GSPC`/`^IXIC`/SPY/QQQ/`^VIX`/DXY/`^TNX` |
| 历史回填 | Yahoo GC=F → 60 日 | ✅ Yahoo SPX+IXIC → `ensureIndexPriceHistory` |
| 搜索原文存档 | `docs/search-raw/` | ✅ 同路径 |
| 数据质量门禁 | 红/黄/绿 + actionable | ✅ 以 SPX 为主、IXIC 为辅 |
| 反驳评分公式 | 向 `(100-bear)` 靠拢 | ✅ `rebuttal-score.ts` |
| 综合分强制一致 | `enforceOverallScore` | ✅ |
| 尾部风险封顶 | `tail-risk.ts` | ✅ maxCap=50 |
| 双打分 LLM×量化 | `dual-score.ts` | ✅ 冲突则维持定投弃权 |
| 量化因子 | 金价+CFTC+TIPS… | ✅ SPX 趋势/RSI/MACD + RS + VIX + DXY + 10Y |
| 可信度一览 | TL;DR 三行 | ✅ |
| 仓位推荐 | 计划黄金仓 | ✅ 计划美股仓（SPY/VOO） |
| 预测对错轨 | `goldrush-stats-latest.json` | ✅ `snprush-stats-latest.json` |
| 结构化日报 | `report-md.ts` | ✅ 可信度→门禁→双分→仓位→情景→四维… |
| 单测 | vitest | ✅ 34 用例 |

## 未移植（黄金特有 / 后续）

- CFTC / GLD 吨数 / PBOC 储备
- 东财黄金新闻、因果链 `gold-causal-rules`
- Web 文章折叠增强版 `server.cjs`（可后续对照）
- Smart analysis 平稳日复用、webhook 推送、周报 digest（P1）

## 验证

```bash
npm run lint   # tsc --noEmit
npm test       # 34 passed
npm run build
```
