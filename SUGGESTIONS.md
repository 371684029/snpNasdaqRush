# SnpRush 改进建议（后续优化路线图）

> 本文档是一次代码体检后给出的**改进建议清单**，与 `IMPROVEMENTS.md`（本轮已实施改进）互补。
> 这里记录的是**架构级 / 需外部服务 / 工作量较大**、本轮未动手的项，按优先级排列，附问题证据、建议方案与风险评估，供后续迭代取用。
>
> 取舍原则同样对齐项目立意（`README.md`：可靠性五道防线、严禁捏造、评分可回测）：优先补齐「正确率 / 反捏造 / 可回测」相关缺口，再谈体验与工程化。

---

## 优先级总览

| 优先级 | 建议 | 关联立意 | 工作量 | 风险 |
|--------|------|----------|--------|------|
| P0 | Validator 落地多源交叉验证 | 反捏造 / 可靠性 | 中 | 中 |
| P0 | 评分一致性（编排分 vs 反驳修正分） | 可回测 / 正确率 | 小 | 低 |
| P1 | `init-history` 真正拉取历史 / 交易日对齐 | 正确率（技术指标） | 中 | 中 |
| P1 | 搜索层：清理 `exa-js` 或补齐双引擎 | 工程一致性 / 反捏造 | 小~中 | 低 |
| P2 | 历史模式匹配（`scenario_features` 相似度） | 可回测增强 | 大 | 中 |
| P2 | 配置项真正生效（`database.path` 等） | 工程一致性 | 小 | 低 |
| P2 | `server.cjs` 端口可配置 / 非特权端口 | 部署体验 | 小 | 低 |
| P3 | 工程化：ESLint + CI + 扩大测试覆盖 | 长期可维护 | 中 | 低 |

---

## P0 — 正确率 / 反捏造核心

### 1. Validator 落地「多源交叉验证」
- **现状**（`src/agents/validator.ts`）：`systemPrompt` 为空、**从不调用 LLM**；每个字段只用**单一来源**调用 `crossValidate`，因此 `maxDev` 恒为 0、`confidence` 恒为 95，"3 源交叉验证"形同虚设。这与 README「同一数据至少 3 个独立来源」「中英文双搜」「反向核查」承诺不符。
- **建议**：
  - 数据采集阶段为每个关键字段保留**多个来源样本**（而非提取后只剩一个值），将多来源数组传入 `crossValidate`，使偏差/置信度真实生效；
  - 偏差超阈值（如 >0.5%）时在报告中显式标注 ⚠️，并下调该字段置信度；
  - 可选：对重大新闻执行「反向核查」检索（搜反对观点）后再交给分析 Agent。
- **风险**：改动采集 → 验证的数据结构契约，需同步 `data-collector` 的 schema 与 `MarketData` 类型。

### 2. 评分一致性：编排自评分 vs 反驳修正分
- **现状**（`src/agents/orchestrator.ts`）：注入校准用的是 `rebuttal.adjustedScore`，但最终报告 `overall.score` 由编排 LLM 自行给出，二者**可能不一致**；回测落库用的是 LLM 自评分（`saveReport` 的 `report.overall.score`），可能与反驳修正逻辑脱节。
- **建议**：明确「唯一可信分」来源——要么以 `adjustedScore` 为准覆盖 LLM 自评分，要么在 prompt 中强约束并在落库前做一致性校验（偏差过大则以修正分为准并记日志）。这样校准闭环统计的才是同一口径的分数。
- **风险**：低，但需决定产品口径（建议以可回测的修正分为准）。

---

## P1 — 数据质量 / 工程一致性

### 3. `init-history` 名副其实 + 技术指标交易日对齐
- **现状**：
  - `src/commands/snapshot.ts` 的 `initHistoryCommand` 名为「初始化最近 60 天」，实际只调用一次 `collectMarketData()`（仅当日一条）；
  - 技术指标（`src/indicators/*`）按"逐条快照"计算，但 `history` 缺失交易日会导致序列**不等间隔**，MA/RSI/MACD 失真；README 提到的"周线"实为日线 close 近似。
- **建议**：
  - `init-history` 真正回拉历史（搜索或引入行情数据源），或在文案上明确其为「逐日积累」而非「一次性回填」，避免误导；
  - 指标计算前做**交易日对齐 / forward-fill**，缺口过大时跳过指标并提示；周线指标用真正的周线重采样。
- **风险**：中，可能需要新数据源（注意"不引入新外部服务"的边界，可先做对齐与文案修正）。

### 4. 搜索层：清理未用依赖或补齐双引擎
- **现状**：`package.json` 声明 `exa-js`，但**全代码无任何引用**（仅文档/配置提及）；实际为 Tavily 单引擎 + DuckDuckGo 兜底（`src/data/`）。`snprush.config.json` 里 `search.engines.exa.enabled=false`。
- **建议**：二选一——① 若不打算用 Exa，移除 `exa-js` 依赖与配置项，README 同步为「Tavily + DDG 兜底」；② 若要兑现「中英文双搜」，落地 Exa 适配器并接入 `SearchRouter`，按配置开关启用。
- **风险**：低（方案①）；中（方案②需 API key）。

---

## P2 — 增强与一致性

### 5. 历史模式匹配（`scenario_features` 相似度）
- **现状**：已落库 `scenario_features`（美元/VIX/动量等特征向量）与回填逻辑，但**未见任何余弦相似度 / 历史相似情景检索**的使用（全代码无 `cosine`/`similar`）。即"历史模式匹配"承诺未兑现。
- **建议**：实现基于特征向量的相似历史情景检索，将"最相似的 N 个历史日及其后续真实走势"注入编排 prompt，强化可回测性与统计意义。
- **风险**：中，属增量功能；先小样本验证有效性再放大。

### 6. 配置项真正生效
- **现状**：`snprush.config.json` 有 `database.path` 等，但全代码未读取 `database.path`（DB 路径在 `src/db/index.ts` 中固定），配置与实际行为不一致。
- **建议**：让 `getDb()` 读取配置中的 `database.path`（带默认值），并审查其余配置项（`autoSnapshot`、`output.language/format` 等）是否真正生效，避免"配置幻觉"。
- **风险**：低。

### 7. `server.cjs` 端口可配置 / 非特权端口
- **现状**：`server.cjs` 硬编码 `PORT = 81`（特权端口，非 root 需提权才能监听）。
- **建议**：改为读取 `process.env.PORT`（默认如 `8081`），降低部署门槛；文档同步。
- **风险**：低。

---

## P3 — 工程化

### 8. 引入 ESLint + CI，扩大测试覆盖
- **现状**：`lint` 仅为 `tsc --noEmit`（类型检查，非代码规范）；本轮已引入 vitest（28 用例，覆盖纯函数）。无 CI。
- **建议**：
  - 增加 ESLint（含 `@typescript-eslint`）统一风格；
  - 增加 GitHub Actions 在 PR 上跑 `lint`/`build`/`test`；
  - 为 `crossValidate`、`adjustScoreWithRebuttal`、`determineRebuttalStrength`、`calibration.computeCalibration`（用内存 SQLite）补测试。
- **风险**：低。

---

## 附：本轮已实施（详见 `IMPROVEMENTS.md`）

正确性（时区/夏令时/盘前边界、满分 100 校准分桶）、反捏造（搜索全空 fail-fast）、健壮性（编排/报告空值防御）、CLI（`history --type` 校验、`calibrate --detail`）、以及 vitest 单测（28/28）。
