# SnpRush — 标普500 & 纳斯达克 投资研究 Agent

一个 CLI 工具，一条命令自动采集美股指数数据、四维度分析、强制反驳、回测校准，输出**短期+中长期双视角**策略报告。

面向通过 **SPY / QQQ / VOO 等美股 ETF** 做标普500与纳斯达克中长期配置的个人投资者，同时兼顾短线参考。

分析流水线（`snprush analysis`）已对齐 goldRush 风格增强：

- **Yahoo 锚定**：`^GSPC` / `^IXIC` 日线补齐历史 + 现货锚定交叉校验
- **数据质量门禁**：绿/黄/红分档，红档关闭加减仓操作建议
- **双打分**：LLM 综合分 × 本地量化分并存，冲突时操作弃权维持定投
- **可信度一览卡**：门禁 / 双分 / 维度一致 / 校准样本压成 TL;DR
- **结构化日报**：`--md` 输出含门禁、双分、仓位、预测对错、情景与尾部风险等分节

> 本项目由 [goldRush](../goldRush)（黄金投资研究 Agent）改造而来，将金价分析框架迁移至美股双指数（SPX + IXIC）+ ETF 配置领域。

---

## 快速开始

### 前置条件

- Node.js >= 20
- opencode HTTP Server 已启动（默认 `http://localhost:8080`，账密通过 `OPENCODE_SERVER` / `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` 环境变量配置）
- （可选）Tavily API Key — 用于实时金融数据搜索；未配置时数据采集依赖 LLM 自身知识，实时性较差

### 安装

```bash
git clone <repo-url> && cd snpNasdaqRush
npm install
npm run build
```

### 配置（可选）

```bash
# Tavily API（金融数据搜索，不配也能跑，会降级到 DuckDuckGo 兜底）
export TAVILY_API_KEY=your_tavily_api_key_here

# 或者写到 .env 文件
cp .env.example .env
# 编辑 .env 填入你的 TAVILY_API_KEY
```

### 运行

```bash
# 查看实时指数行情
node dist/index.js price

# 综合分析报告（默认双视角）
node dist/index.js analysis

# 只看短期视角
node dist/index.js analysis -H short

# 只看中长期视角
node dist/index.js analysis -H mid

# ETF 对比分析
node dist/index.js etf

# 回测校准
node dist/index.js calibrate

# 查看历史数据
node dist/index.js history

# 生成 Markdown 报告（保存到 docs/ 目录）
node dist/index.js analysis --md
```

建议设置 alias 方便使用：

```bash
alias snprush="node /path/to/snpNasdaqRush/dist/index.js"
snprush price
snprush analysis
```

---

## 命令一览

| 命令 | 说明 | 优先级 |
|------|------|--------|
| `snprush price` | 实时指数行情速查（自动存 SQLite） | P0 |
| `snprush analysis` | 综合分析报告（四维度+反驳+情景+双轨策略） | P1 |
| `snprush analysis -H short` | 仅短期视角（日线/入场止损） | P1 |
| `snprush analysis -H mid` | 仅中长期视角（周线/定投加减仓） | P1 |
| `snprush analysis --json` | JSON 格式输出 | P1 |
| `snprush analysis --save` | 保存报告到文件 (JSON) | P1 |
| `snprush analysis --md` | 保存报告为 Markdown 到 docs/ 目录 | P1 |
| `snprush etf` | ETF 对比分析（SPY/QQQ/VOO 费率/溢价/配置建议） | P1 |
| `snprush calibrate` | 回测校准（历史准确率统计） | P1 |
| `snprush calibrate --days 90` | 回顾 90 天 | P1 |
| `snprush snapshot` | 手动保存当日数据快照 | P1 |
| `snprush init-history` | 首次拉取历史数据（Yahoo，默认 60 天） | P1 |
| `snprush init-history --days 90` | 拉取指定天数历史 | P1 |
| `snprush history` | 查看历史指数 | P1 |
| `snprush history --type reports` | 查看历史分析报告 | P1 |

---

## 架构

```
用户 CLI 命令
    │
    ▼
Commander.js (命令路由)
    │
    ▼
Orchestrator (编排层)
    │
    ├──→ 数据采集 Agent (deepseek-v4-pro)
    │     Tavily 实时搜索（可选）
    │     交叉验证 + 来源分级 (A/B/C)
    │
    ├──→ 四维度分析 (deepseek-v4-pro × 4，串行执行)
    │     ├── 技术面 (双指数本地计算 MA/RSI/MACD + LLM 解读)
    │     │         SPX 短期/中长期 + IXIC 短期/中长期 + 相对强弱 + 板块轮动
    │     ├── 基本面 (估值水位/盈利展望/美联储政策/宏观)
    │     ├── 情绪面 (VIX/P-C比率/资金流/机构持仓/市场宽度)
    │     └── ETF/板块面 (SPY/QQQ/VOO 对比 + 板块轮动信号)
    │
    ├──→ 强制反驳 Agent (deepseek-v4-pro, 独立 session)
    │     专门找看空论据，客观指标判定反驳强度
    │     评分修正: weak=10% / moderate=20% / strong=35%
    │
    └──→ 综合编排 Agent (deepseek-v4-pro)
          注入校准上下文 + 三情景分析 + 尾部风险
          输出双轨策略: 短期入场止损 + 中长期定投加减仓 + 股债配置建议
```

---

## 核心设计

### 双指数分析

相对 goldRush 的单资产分析，SnpRush 在技术面同时分析 SPX 与 IXIC：

- **SPX vs IXIC 相对强弱**：识别纳指领先/落后标普的轮动信号
- **板块轮动**：科技→金融→医疗→能源→防御的传导路径
- **股债配置建议**：基于估值水位与利率环境给出股/债比例

### 信息可靠性五道防线

1. **来源分级** — A级(S&P/NASDAQ/美联储/BLS/Bloomberg/Reuters) > B级(CNBC/WSJ/Yahoo Finance/MarketWatch) > C级(其他)
2. **3源交叉验证** — 同一数据至少3个独立来源
3. **中英文双搜** — 避免单一信息茧房
4. **反向核查** — 重大新闻必须搜反对观点
5. **时效标注** — 每个数据标注获取时间和来源

### 强制反驳机制

正常分析天然偏乐观。强制反驳 Agent 独立运行，专门找看空论据：

```
四维度分析 → 初步评分 70 分
    ↓
反驳 Agent (看不到综合评分，避免锚定)
    ↓
看空力度 42/100，反驳强度 moderate
    ↓
评分修正: 70 → 64 (下调 6 分)
    ↓
最终输出: 64 分 + 反驳摘要 + 尾部风险
```

### 双视角输出

| 维度 | 短期 | 中长期 |
|------|------|--------|
| 时间框架 | 日线/小时线 | 周线/月线 |
| 持仓周期 | 数天~2周 | 1~6个月 |
| 推荐品种 | SPY / QQQ 场内ETF | VOO 核心持仓 + QQQ 卫星配置 |
| 策略核心 | SPX/IXIC 双入场点位、止盈止损 | 定投节奏、加减仓、股债配置 |
| 风控方式 | 固定止损 3-5% | 估值止盈、仓位管理 |

### 回测校准闭环

每次分析自动存档到 SQLite，`snprush calibrate` 对比历史研判 vs 实际走势：

```
评分区间  样本  实际涨概率  平均涨幅  偏差
60-70     12    58%       +0.3%    偏乐观8%
70-80     18    67%       +0.8%    校准良好
80-90      8    75%       +1.2%    偏保守
90-100     2    50%      -0.1%    严重偏乐观！
```

校准数据自动注入综合编排 prompt，让评分有统计意义。

---

## 报告查看

启动内置 HTTP 服务即可在浏览器查看所有 Markdown 报告：

```bash
node server.cjs
# 访问 http://localhost:81
# 或服务器 IP: http://106.14.92.235:81
```

运行 `analysis --md` 会在 `docs/` 目录生成当日 Markdown 报告：

```bash
node dist/index.js analysis --md    # 生成 docs/snprush-analysis-YYYY-MM-DD.md
```

报告包含完整四维度分析、强制反驳、双轨策略和尾部风险，并附带**数据质量门禁、双打分、可信度一览、仓位推荐、历史预测对错**等结构化分节，可直接用于发文章或归档查阅。每次分析也自动存入 SQLite（`analysis_reports` 表），可通过 `history --type reports` 查看。

### 每日定时分析

已在服务器设置每日 11:20 自动执行分析并生成 Markdown 报告（cron）：

```bash
crontab -l
# 30 11 * * * /root/git/snpNasdaqRush/scripts/daily-analysis.sh
```

日志文件在 `logs/daily-YYYY-MM-DD.log`，报告自动保存到 `docs/` 目录。

---

## 本地数据存储

SQLite 数据库自动创建在 `data/snprush.db`：

| 表 | 用途 |
|----|------|
| `index_prices` | 每日指数快照（SPX/IXIC/SPY/QQQ/VIX/美元/美债 10Y+2Y/TIPS） |
| `etf_nav` | ETF 净值快照（SPY/QQQ/VOO 等） |
| `analysis_reports` | 分析报告存档（含完整 JSON） |
| `scenario_features` | 市场特征向量（用于历史模式匹配） |
| `search_cache` | 搜索缓存（5分钟内免重复请求） |

每次运行 `price` 或 `analysis` 自动存数据，无需手动操作。

---

## 技术指标

本地计算，100% 客观，不依赖 LLM：

| 指标 | 实现 | 用途 |
|------|------|------|
| MA5/MA20/MA60 | `src/indicators/ma.ts` | 均线趋势、金叉死叉 |
| RSI(14) | `src/indicators/rsi.ts` | 超买超卖信号 |
| MACD | `src/indicators/macd.ts` | 动量方向、金叉死叉 |
| 布林带 | `src/indicators/bollinger.ts` | 波动区间、%B |
| 历史百分位 | `src/indicators/percentile.ts` | 估值水位判断 |

数据积累 20 天后技术指标自动生效，注入技术面 Agent prompt。SPX 与 IXIC 各自独立计算。

---

## 项目结构

```
snpNasdaqRush/
├── src/
│   ├── index.ts              # CLI 入口 (Commander.js)
│   ├── commands/
│   │   ├── price.ts          # 实时指数行情
│   │   ├── analysis.ts       # 综合分析报告
│   │   ├── etf.ts            # ETF 对比分析
│   │   ├── calibrate.ts      # 回测校准
│   │   ├── snapshot.ts       # 数据快照
│   │   └── history.ts        # 历史数据
│   ├── agents/
│   │   ├── base.ts           # Agent 基类 (opencode HTTP API)
│   │   ├── data-collector.ts # 数据采集 + Tavily 搜索
│   │   ├── validator.ts      # 信息验证 + 来源分级
│   │   ├── analysis-agents.ts# 四维度 Agent (技术/基本/情绪/ETF)
│   │   ├── rebuttal.ts       # 强制反驳 Agent
│   │   └── orchestrator.ts   # 综合编排 Agent
│   ├── data/
│   │   ├── tavily-client.ts  # Tavily API 封装（可选搜索）
│   │   └── search-router.ts  # 搜索路由器
│   ├── db/
│   │   ├── index.ts          # SQLite 初始化
│   │   ├── index-prices.ts   # 指数快照 CRUD
│   │   ├── etf-nav.ts        # ETF 净值 CRUD
│   │   ├── reports.ts        # 报告存档 CRUD
│   │   ├── scenario-features.ts # 特征向量 CRUD
│   │   ├── search-cache.ts   # 搜索缓存
│   │   └── calibration.ts    # 校准回测逻辑
│   ├── indicators/
│   │   ├── ma.ts             # 均线
│   │   ├── rsi.ts            # RSI
│   │   ├── macd.ts           # MACD
│   │   ├── bollinger.ts      # 布林带
│   │   └── percentile.ts     # 历史百分位
│   ├── types/                # TypeScript 类型定义
│   └── utils/                # 工具函数（含美东时区判断、夏令时处理）
├── data/
│   └── snprush.db            # SQLite (自动创建)
├── docs/                     # Markdown 分析报告 (analysis --md)
├── scripts/
│   └── daily-analysis.sh     # 每日定时分析脚本 (cron 11:20)
├── logs/                     # 定时运行日志
├── server.cjs                # 报告展示 HTTP 服务 (端口 81)
├── snprush.config.json       # 配置文件 (LLM/搜索/数据库)
├── package.json
└── tsconfig.json
```

---

## 技术栈

| 组件 | 选型 | 原因 |
|------|------|------|
| 语言 | TypeScript | 类型安全 |
| CLI | Commander.js | 成熟稳定 |
| LLM | opencode HTTP API（`deepseek-v4-pro`） | 本地 LLM，可替换模型 |
| 搜索 | Tavily API（可选，无 key 时依赖 LLM 知识） | 金融数据覆盖好 |
| 数据库 | SQLite (better-sqlite3) | 零配置、本地、够用 |
| 终端输出 | chalk + cli-table3 | 表格+颜色 |
| 报告展示 | 内置 HTTP 服务 (server.cjs) | 端口 81 文件列表页 |

### 启动报告展示页

```bash
node server.cjs
# 访问 http://localhost:81 查看 docs/ 下所有报告
# 服务器访问: http://106.14.92.235:81
```

---

## 开发

```bash
# 开发模式（直接运行 TS）
npm run dev -- price

# 编译
npm run build

# 类型检查
npm run lint

# 单元测试
npm test
```

---

## 配置文件

`snprush.config.json`：

```json
{
  "llm": { "provider": "opencode-go", "models": { ... 各 Agent 模型配置 } },
  "search": { "engines": { "exa": { "enabled": false }, "opencode": { "enabled": true } } },
  "database": { "path": "./data/snprush.db", "autoSnapshot": true },
  "investment": { "horizon": "all", "platform": "any" },
  "output": { "language": "zh-CN", "format": "table" }
}
```

---

## 注意事项

- 本工具仅供投资研究参考，**不构成投资建议**
- LLM 分析存在固有局限，请结合自身判断做出决策
- 数据依赖搜索结果，可能存在延迟或偏差
- 建议积累 20 天以上数据后再使用 `calibrate` 命令
- Tavily API 免费额度 1000 次/月，每次 analysis 约消耗 5-10 次
- 时区处理采用美东时间（ET）+ 夏令时自动判断