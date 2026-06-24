# SnpRush 改进存档

> 本文档归纳一次代码体检后实施的改进，方法对齐姊妹项目 goldRush 的同类改造（正确率 / 反捏造 / 健壮性 / 可测试性），
> **不改动整体架构、不引入新外部服务**。改进原则源自项目立意（见 `README.md`）：本工具的价值不在于「说得像」，
> 而在于**数值本地计算防幻觉、严禁捏造数据、评分可回测**。

---

## 一、项目立意回顾（为何这样改）

SnpRush 是面向美股 ETF（SPY/QQQ/VOO）配置者的 CLI 研究 Agent：一条命令完成「采集 → 验证 → 四维度分析 →
强制反驳 → 情景 + 双轨策略」，并通过**回测校准闭环**让评分具备统计意义。文档反复强调的核心是可靠性五道防线与反捏造。
本轮改进即针对「实现与立意有偏差」之处。

> 说明：snpNasdaqRush 由 goldRush 衍生，但面向**美股双指数（SPX+IXIC）+ ET 时区**。因此 goldRush 改造中的
> 「上海时区交易时段」「rollingPercentile 窗口」「checkFreshness 非法时间戳」等并不能照搬——其中
> `rollingPercentile`（本项目实现已含当前值）与 `checkFreshness`（本项目已有非法/空时间戳守卫）**本就正确，未改动**。

---

## 二、改进清单

### A. 正确性 / 算法 bug

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| A1 | `src/utils/time.ts` `todayDate()` | 手动 `+8h + getTimezoneOffset()` 再 `toISOString()`，在 **UTC+8 机器**上偏移被抵消，返回 UTC 日期而非北京日历日，导致「今日」判断与入库 key 错位 | 改用 `Intl.DateTimeFormat(timeZone:'Asia/Shanghai')` 取日历分量，不受运行机器时区影响；支持注入 `now` 便于测试 |
| A2 | `src/utils/time.ts` `getTradingTime()` | 手写夏令时（`isDaylightTime`/`getNthSunday`）+ 机器时区偏移，脆弱易错；且 **09:00~09:30 区间被漏判为休市** | 改用 `Intl.DateTimeFormat(timeZone:'America/New_York')` **自动处理夏令时**；补齐盘前区间为 04:00~09:30；支持注入 `now` |
| A3 | `src/db/calibration.ts` / `src/db/reports.ts` | 评分区间左闭右开 `[min,max)`，**满分 100 落不进任何区间** → `getCalibrationContext(100)` 返回 `null`，满分报告无校准上下文、回测被丢弃 | 抽出纯函数 `src/utils/score-buckets.ts`（`scoreBucketRange`，最高区间右端取闭）；`computeCalibration` 与 `getByScoreRange` 统一令 max=100 时取闭区间 |

### B. 反捏造（对齐「严禁捏造数据」）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| B1 | `src/agents/data-collector.ts` | 搜索结果全空（无 `TAVILY_API_KEY` 且兜底也无结果）时**仍调用 LLM 做"结构化提取"**，极易凭空捏造指数点位 | 采集前增加反捏造防线：若所有搜索结果为空则 **fail-fast** 抛出明确错误，绝不让 LLM 无据生成 |

### C. 健壮性 / 空值防御（LLM 可能返回 null 字段）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| C1 | `src/agents/orchestrator.ts` | prompt 与 `saveReport` 直接访问 `marketData.vix.value.value`、`dollarIndex.value.change`、`rebuttal.bearPoints.map` 等可空字段 → 运行期 `TypeError` 中断流水线 | 可选链 + `?? 'N/A'` / `?? 0` / `?? []` 防御，新增 `fmtPct` 统一格式化 |
| C2 | `src/commands/analysis.ts` | `printReport`/`renderReportMarkdown` 中 `rebuttal.bearPoints.slice`、`bullVulnerabilities`、`tailRisks` 在字段缺失时崩溃 | 统一 `(... ?? []).slice` / 先取 `tailRisks ?? []` |

### D. CLI 一致性 / 功能补齐

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| D1 | `src/index.ts` | `history --type` 无白名单校验，非法值静默走错误分支 | 校验 `prices/reports`，非法值报错退出 |
| D2 | `src/commands/calibrate.ts` | `--detail` 选项已注册但**完全未使用**（死选项） | 实现 `--detail`：按评分区间展开「预测方向 / 实际上涨数 / 校准误差 / 系统偏差」明细 |

---

## 三、测试（项目此前零测试）

引入 **vitest**（`npm test` → `vitest run`），针对纯函数编写单元测试，共 **28 个用例全部通过**：

| 测试文件 | 覆盖 |
|----------|------|
| `test/time.test.ts` | `todayDate` 上海时区跨日；`getTradingTime` 美东盘前/盘中/盘后边界、冬夏令时自动切换、周末休市 |
| `test/percentile.test.ts` | `percentile` 边界、`rollingPercentile` 含当前值、`valuationLevel` 水位 |
| `test/source-rank.test.ts` | `gradeSource` A/B/C 分级；`checkFreshness` 缺失/非法/新鲜/过期 |
| `test/score-buckets.test.ts` | `scoreBucketRange` 满分 100 归入 90-100、边界与越界 |

> 测试置于 `test/` 目录，不在 `tsconfig` 的 `include`（`src/**/*`）内，故不会被 `build`/`lint` 编译进 `dist`。

---

## 四、验证方式

- `npm run lint`（`tsc --noEmit`）通过；
- `npm run build`（`tsc`）通过；
- `npm test`（vitest）28/28 通过；
- 端到端：用应用自身仓储向本地 SQLite 注入 60 天指数价 + 5 条报告（含满分 100），`calibrate --days 90 --detail`：
  - `90-100` 区间样本数为 **2**（含 92 与 100，证明满分不再被丢弃）；
  - `--detail` 明细正常输出（证明死选项已生效）；
- `node dist/index.js price`（无 `TAVILY_API_KEY` 且兜底无结果）现以**明确的反捏造提示**中止，而非含糊的 `fetch failed`。

---

## 五、未在本轮处理（建议后续）

以下为体检中发现、但属于**架构级 / 需外部服务或更大改动**的差距，留作后续：

- **搜索层单一**：文档提及 Exa + opencode 双引擎，实现为 Tavily 单引擎 + DuckDuckGo 兜底（`exa-js` 依赖未使用）；
- **Validator 未做多源交叉验证 / 未调用 LLM**，与「3 源验证」承诺不符；
- **`init-history` 名不副实**：未真正拉取 60 天历史；
- **技术指标序列**：`history` 压缩缺失交易日导致指标序列不等间隔（需 forward-fill / 交易日对齐）；
- **历史模式匹配**（`scenario_features` 余弦相似度）与 `search_cache` 等尚未完全落地；
- **评分一致性**：编排 LLM 自出的 `overall.score` 未必等于反驳修正分 `adjustedScore`。
