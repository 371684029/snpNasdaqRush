// 四维度分析 Agent — 标普500 & 纳斯达克

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { latestMA, latestRSI, rsiSignal, latestMACD, macdCross, latestBollinger, deviationFromMA } from '../indicators/index.js';
import type { TechnicalAnalysis, FundamentalAnalysis, SentimentAnalysis } from '../types/analysis.js';
import type { MarketData } from '../types/market.js';
import type { EtfAnalysis } from '../types/etf.js';

/** 安全读取嵌套字段 */
function safeVal<T>(fn: () => T, fallback: T): T {
  try { const v = fn(); return v ?? fallback; } catch { return fallback; }
}
function safeStr(fn: () => number | null | undefined, suffix = '', prefix = ''): string {
  try { const v = fn(); return v != null ? `${prefix}${v}${suffix}` : 'N/A'; } catch { return 'N/A'; }
}

// ============ 技术面 Agent ============
const TECHNICAL_PROMPT = `你是美股技术面分析专家，同时提供短期（日线）和中长期（周线）两个视角的分析。你需要分别分析标普500 (SPX) 和纳斯达克 (IXIC)。

## 双视角分析规则

### 短期视角（日线级别，持仓数天~2周）
- 分析周期：日K线、小时线
- 技术指标：5日/20日均线、日线MACD、日线RSI
- 操作建议：精确入场区间、止盈目标、止损位
- 风控方式：固定止损（3-5%）

### 中长期视角（周线级别，持仓1~6个月）
- 分析周期：周K线、月K线
- 技术指标：20周/60周均线、周线MACD、周线RSI
- 操作建议：定投节奏调整、波段加减仓
- 推荐品种：SPY（核心持仓）、QQQ（成长暴露）

## 规则
1. 严禁捏造数据
2. 优先使用注入的本地计算指标
3. 必须包含双指数对比和相对强弱分析
4. 必须包含板块轮动信号
5. 每个结论必须有依据
6. 必须包含至少1条反面论据

## 输出格式
{
  "score": 0-100,
  "direction": "bullish/bearish/neutral",
  "keyPoints": ["论点1", "论点2", "论点3"],
  "counterPoints": ["反方论据"],
  "summary": "一句话总结",
  "sources": ["来源1", "来源2"],
  "spx": {
    "shortTerm": { "timeframe": "daily", "support": 数字, "resistance": 数字, "trend": "趋势", "indicators": { "ma5": "状态", "ma20": "状态", "macd": "状态", "rsi": "状态" }, "keySignal": "信号" },
    "midTerm": { "timeframe": "weekly", "support": 数字, "resistance": 数字, "trend": "趋势", "indicators": { "ma20w": "状态", "ma60w": "状态", "macd": "状态", "rsi": "状态" }, "keySignal": "信号" }
  },
  "ixic": {
    "shortTerm": { "timeframe": "daily", "support": 数字, "resistance": 数字, "trend": "趋势", "indicators": { "ma5": "状态", "ma20": "状态", "macd": "状态", "rsi": "状态" }, "keySignal": "信号" },
    "midTerm": { "timeframe": "weekly", "support": 数字, "resistance": 数字, "trend": "趋势", "indicators": { "ma20w": "状态", "ma60w": "状态", "macd": "状态", "rsi": "状态" }, "keySignal": "信号" }
  },
  "relativeStrength": "SPX vs IXIC 相对强弱",
  "sectorRotation": "板块轮动信号"
}`;

export class TechnicalAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'technical', model: config.models.technical, systemPrompt: TECHNICAL_PROMPT });
  }

  async analyze(data: MarketData): Promise<TechnicalAnalysis> {
    const spxPrice = safeVal(() => data.spx.price.value, 0);
    const ixicPrice = safeVal(() => data.ixic.price.value, 0);
    const vix = safeVal(() => data.vix.value.value, 0);
    const dollarIdx = safeVal(() => data.dollarIndex.value.value, 0);
    const dollarChange = safeVal(() => data.dollarIndex.value.change, 0);

    const db = getDb();
    const repo = new IndexPricesRepo(db);
    const history = repo.getRecent(60);

    let indicatorContext = '';
    if (history.length >= 20) {
      const spxCloses = history.map(h => h.spxClose).filter((v): v is number => v !== null);
      const ixicCloses = history.map(h => h.ixicClose).filter((v): v is number => v !== null);

      if (spxCloses.length >= 20) {
        const spxMA5 = latestMA(spxCloses, 5);
        const spxMA20 = latestMA(spxCloses, 20);
        const spxMA60 = spxCloses.length >= 60 ? latestMA(spxCloses, 60) : null;
        const spxRSI = latestRSI(spxCloses, 14);
        const spxMACD = latestMACD(spxCloses);
        const spxMACDCross = macdCross(spxCloses);
        const spxBB = latestBollinger(spxCloses);
        const spxDev = deviationFromMA(spxCloses, 20);
        const spxLatestDev = spxDev.filter((v): v is number => v !== null).pop() ?? null;

        const ixicMA5 = ixicCloses.length >= 5 ? latestMA(ixicCloses, 5) : null;
        const ixicMA20 = ixicCloses.length >= 20 ? latestMA(ixicCloses, 20) : null;
        const ixicRSI = ixicCloses.length >= 14 ? latestRSI(ixicCloses, 14) : null;
        const ixicMACD = ixicCloses.length >= 26 ? latestMACD(ixicCloses) : null;

        indicatorContext = `
## 本地计算的 SPX 技术指标（客观结果）
- SPX: ${spxPrice.toFixed(2)}
- MA5: ${spxMA5?.toFixed(2) ?? 'N/A'} | MA20: ${spxMA20?.toFixed(2) ?? 'N/A'} | MA60: ${spxMA60?.toFixed(2) ?? 'N/A'}
- RSI(14): ${spxRSI?.toFixed(1) ?? 'N/A'} ${spxRSI ? rsiSignal(spxRSI) : ''}
- MACD: ${spxMACD ? `MACD=${spxMACD.macd?.toFixed(2)}, Signal=${spxMACD.signal?.toFixed(2)}, Hist=${spxMACD.histogram?.toFixed(2)}` : 'N/A'}
- MACD交叉: ${spxMACDCross === 'golden' ? '金叉✅' : spxMACDCross === 'dead' ? '死叉❌' : '无交叉'}
- 布林带 %B: ${spxBB?.percentB?.toFixed(2) ?? 'N/A'}
- 偏离MA20: ${spxLatestDev?.toFixed(2) ?? 'N/A'}%

## 本地计算的 IXIC 技术指标
- IXIC: ${ixicPrice.toFixed(2)}
- MA5: ${ixicMA5?.toFixed(2) ?? 'N/A'} | MA20: ${ixicMA20?.toFixed(2) ?? 'N/A'}
- RSI(14): ${ixicRSI?.toFixed(1) ?? 'N/A'} ${ixicRSI ? rsiSignal(ixicRSI) : ''}
- MACD: ${ixicMACD ? `Hist=${ixicMACD.histogram?.toFixed(2)}` : 'N/A'}

## 其他市场数据
- VIX: ${vix}
- 美元指数: ${dollarIdx} (${dollarChange > 0 ? '+' : ''}${dollarChange}%)
- 10Y美债: ${safeStr(() => data.usTreasury.yield10y.value, '%')}
- 2Y美债: ${safeStr(() => data.usTreasury.yield2y.value, '%')}`;
      }
    } else {
      indicatorContext = '## 本地技术指标：历史数据不足（需20天以上）';
    }

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
        keyPoints: { type: 'array', items: { type: 'string' } },
        counterPoints: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        spx: {
          type: 'object',
          properties: {
            shortTerm: { type: 'object', properties: { timeframe: { type: 'string' }, support: { type: 'number' }, resistance: { type: 'number' }, trend: { type: 'string' }, indicators: { type: 'object' }, keySignal: { type: 'string' } } },
            midTerm: { type: 'object', properties: { timeframe: { type: 'string' }, support: { type: 'number' }, resistance: { type: 'number' }, trend: { type: 'string' }, indicators: { type: 'object' }, keySignal: { type: 'string' } } },
          },
        },
        ixic: {
          type: 'object',
          properties: {
            shortTerm: { type: 'object', properties: { timeframe: { type: 'string' }, support: { type: 'number' }, resistance: { type: 'number' }, trend: { type: 'string' }, indicators: { type: 'object' }, keySignal: { type: 'string' } } },
            midTerm: { type: 'object', properties: { timeframe: { type: 'string' }, support: { type: 'number' }, resistance: { type: 'number' }, trend: { type: 'string' }, indicators: { type: 'object' }, keySignal: { type: 'string' } } },
          },
        },
        relativeStrength: { type: 'string' },
        sectorRotation: { type: 'string' },
      },
      required: ['score', 'direction', 'keyPoints', 'counterPoints', 'summary', 'sources', 'spx', 'ixic', 'relativeStrength', 'sectorRotation'],
    };

    return this.structuredPrompt<TechnicalAnalysis>(
      `${indicatorContext}\n\n请对 SPX 和 IXIC 进行技术面双视角分析，包含相对强弱和板块轮动判断。`,
      schema,
    );
  }
}

// ============ 基本面 Agent ============
const FUNDAMENTAL_PROMPT = `你是美股基本面分析专家，从宏观经济角度分析美股走势，覆盖标普500和纳斯达克。

## 分析维度
- 美股估值水位（CAPE、Fwd PE、PB）
- 企业盈利展望（EPS增长、利润率）
- 美联储货币政策（利率路径、缩表）
- 宏观数据（GDP、CPI、非农就业、PMI）
- 经济周期判断

## 信息可靠性规则
1. 严禁捏造数据
2. 因果推理必须标注条件和反例
3. 必须包含至少1条反面论据

## 输出格式
{
  "score": 0-100,
  "direction": "bullish/bearish/neutral",
  "keyPoints": ["论点1", "论点2", "论点3"],
  "counterPoints": ["反方论据"],
  "summary": "一句话总结",
  "sources": ["来源1"],
  "valuationLevel": "估值水位描述",
  "earningsOutlook": "盈利展望",
  "fedPolicy": "美联储政策影响",
  "macroIndicators": "宏观数据分析"
}`;

export class FundamentalAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'fundamental', model: config.models.fundamental, systemPrompt: FUNDAMENTAL_PROMPT });
  }

  async analyze(data: MarketData): Promise<FundamentalAnalysis> {
    const spxPrice = safeVal(() => data.spx.price.value, 0);
    const spxPe = safeVal(() => data.spx.pe?.value, 0);
    const vix = safeVal(() => data.vix.value.value, 0);
    const us10y = safeVal(() => data.usTreasury.yield10y.value, 0);
    const us2y = safeVal(() => data.usTreasury.yield2y.value, 0);

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
        keyPoints: { type: 'array', items: { type: 'string' } },
        counterPoints: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        valuationLevel: { type: 'string' },
        earningsOutlook: { type: 'string' },
        fedPolicy: { type: 'string' },
        macroIndicators: { type: 'string' },
      },
      required: ['score', 'direction', 'keyPoints', 'counterPoints', 'summary', 'sources', 'valuationLevel', 'earningsOutlook', 'fedPolicy', 'macroIndicators'],
    };

    return this.structuredPrompt<FundamentalAnalysis>(
      `## 市场数据\nSPX: ${spxPrice} | PE: ${spxPe}\nVIX: ${vix}\n10Y: ${us10y}% | 2Y: ${us2y}%\n美元指数: ${safeVal(() => data.dollarIndex.value.value, 0)}\n\n请进行基本面分析。`,
      schema,
    );
  }
}

// ============ 情绪面 Agent ============
const SENTIMENT_PROMPT = `你是美股情绪面分析专家，从市场情绪和资金流向角度分析标普500和纳斯达克。

## 分析维度
- VIX恐慌指数趋势
- Put/Call 比率
- 资金流向（股票型ETF流入/流出）
- 机构持仓变化（13F）
- 市场宽度（涨跌比、新高新低）
- AAII投资者情绪调查

## 信息可靠性规则
1. 严禁捏造数据
2. 情绪指标需标注方向和强度
3. 必须包含至少1条反面论据

## 输出格式
{
  "score": 0-100,
  "direction": "bullish/bearish/neutral",
  "keyPoints": ["论点1", "论点2", "论点3"],
  "counterPoints": ["反方论据"],
  "summary": "一句话总结",
  "sources": ["来源1"],
  "vixAnalysis": "VIX 解读",
  "putCallRatio": "Put/Call 比率分析",
  "fundFlows": "资金流向",
  "institutionalPositions": "机构持仓变化",
  "marketBreadth": "市场宽度"
}`;

export class SentimentAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'sentiment', model: config.models.sentiment, systemPrompt: SENTIMENT_PROMPT });
  }

  async analyze(data: MarketData): Promise<SentimentAnalysis> {
    const spxPrice = safeVal(() => data.spx.price.value, 0);
    const spxChange = safeVal(() => data.spx.price.change, 0);
    const vix = safeVal(() => data.vix.value.value, 0);
    const spyNav = safeVal(() => data.spy.nav.value, 0);

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
        keyPoints: { type: 'array', items: { type: 'string' } },
        counterPoints: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        vixAnalysis: { type: 'string' },
        putCallRatio: { type: 'string' },
        fundFlows: { type: 'string' },
        institutionalPositions: { type: 'string' },
        marketBreadth: { type: 'string' },
      },
      required: ['score', 'direction', 'keyPoints', 'counterPoints', 'summary', 'sources', 'vixAnalysis', 'putCallRatio', 'fundFlows', 'institutionalPositions', 'marketBreadth'],
    };

    return this.structuredPrompt<SentimentAnalysis>(
      `## 市场数据\nSPX: ${spxPrice} (${spxChange}%)\nVIX: ${vix}\nSPY: ${spyNav}\n\n请进行情绪面分析。`,
      schema,
    );
  }
}

// ============ ETF/板块面 Agent ============
const ETF_PROMPT = `你是美股 ETF 和板块分析专家。分析 SPY、QQQ、VOO 等核心 ETF 和板块轮动。

## 分析要点
- SPY（标普500 ETF）：管理费0.09%，适合核心配置
- QQQ（纳斯达克100 ETF）：管理费0.20%，适合成长风格暴露
- VOO（先锋标普500 ETF）：管理费0.03%，成本最低
- 关注板块轮动信号：科技→金融→医疗→能源→防御

## 输出格式
{
  "comparisons": [{
    "code": "SPY", "name": "SPDR S&P 500 ETF",
    "nav": 净值, "feeRate": 费率, "aum": 规模亿, "dividendYield": 股息率,
    "recommendation": "适用场景"
  }],
  "recommendation": {
    "coreHold": "核心持仓推荐",
    "growthFocus": "成长风格推荐",
    "valueFocus": "价值风格推荐",
    "dipBuy": "逢跌定投推荐"
  },
  "valuation": { "level": "low/fair/high", "indicator": "判断依据", "action": "操作建议" },
  "sectorRotation": {
    "leading": ["领涨板块1", "领涨板块2"],
    "lagging": ["落后板块1", "落后板块2"],
    "rotationSignal": "轮动信号描述",
    "defensiveShift": false
  }
}`;

export class EtfFundAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'etf', model: config.models.etf, systemPrompt: ETF_PROMPT });
  }

  async analyze(data: MarketData): Promise<EtfAnalysis> {
    const spxPe = safeVal(() => data.spx.pe?.value, 0);
    const spyNav = safeVal(() => data.spy.nav.value, 0);
    const qqqNav = safeVal(() => data.qqq.nav.value, 0);
    const spyPrem = safeVal(() => data.spy.premiumDiscount?.value, 0);
    const vix = safeVal(() => data.vix.value.value, 0);

    const schema = {
      type: 'object',
      properties: {
        comparisons: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' }, name: { type: 'string' },
              nav: { type: 'number' }, feeRate: { type: 'number' },
              aum: { type: 'number' }, dividendYield: { type: 'number' },
              recommendation: { type: 'string' },
            },
          },
        },
        recommendation: {
          type: 'object',
          properties: {
            coreHold: { type: 'string' }, growthFocus: { type: 'string' },
            valueFocus: { type: 'string' }, dipBuy: { type: 'string' },
          },
        },
        valuation: { type: 'object', properties: { level: { type: 'string' }, indicator: { type: 'string' }, action: { type: 'string' } } },
        sectorRotation: { type: 'object', properties: { leading: { type: 'array', items: { type: 'string' } }, lagging: { type: 'array', items: { type: 'string' } }, rotationSignal: { type: 'string' }, defensiveShift: { type: 'boolean' } } },
      },
      required: ['comparisons', 'recommendation', 'valuation', 'sectorRotation'],
    };

    return this.structuredPrompt<EtfAnalysis>(
      `## 市场数据\nSPX PE: ${spxPe}\nSPY: ${spyNav} | QQQ: ${qqqNav}\nSPY溢价: ${spyPrem}%\nVIX: ${vix}\n\n请分析ETF估值、推荐配置和板块轮动信号。`,
      schema,
    );
  }
}
