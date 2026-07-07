// 分析结果类型定义 — 标普500 & 纳斯达克

/** 分析方向 */
export type Direction = 'bullish' | 'bearish' | 'neutral';

/** 单维度分析结果 */
export interface DimensionAnalysis {
  score: number;          // 0-100
  direction: Direction;
  keyPoints: string[];    // 3-5条关键论点
  counterPoints: string[]; // 至少1条反面论据
  summary: string;        // 一句话总结
  sources: string[];      // 信息来源列表
}

/** 短期技术指标（日线级别） */
export interface ShortTermIndicators {
  timeframe: 'daily';
  support: number;
  resistance: number;
  trend: string;
  indicators: {
    ma5: string;
    ma20: string;
    macd: string;
    rsi: string;
  };
  keySignal: string;
}

/** 中长期技术指标（周线级别） */
export interface MidTermIndicators {
  timeframe: 'weekly';
  support: number;
  resistance: number;
  trend: string;
  indicators: {
    ma20w: string;
    ma60w: string;
    macd: string;
    rsi: string;
  };
  keySignal: string;
}

/** 技术面分析（双指数） */
export interface TechnicalAnalysis extends DimensionAnalysis {
  spx: {
    shortTerm: ShortTermIndicators;
    midTerm: MidTermIndicators;
  };
  ixic: {
    shortTerm: ShortTermIndicators;
    midTerm: MidTermIndicators;
  };
  relativeStrength: string;    // SPX vs IXIC 相对强弱描述
  sectorRotation: string;      // 板块轮动信号
}

/** 基本面分析 */
export interface FundamentalAnalysis extends DimensionAnalysis {
  valuationLevel: string;      // 美股整体估值水位
  earningsOutlook: string;     // 盈利展望
  fedPolicy: string;           // 美联储政策影响
  macroIndicators: string;     // 宏观数据影响（GDP/CPI/就业）
}

/** 情绪面分析 */
export interface SentimentAnalysis extends DimensionAnalysis {
  vixAnalysis: string;         // VIX 解读
  putCallRatio: string;        // Put/Call 比率
  fundFlows: string;           // 资金流向
  institutionalPositions: string; // 机构持仓变化
  marketBreadth: string;       // 市场宽度
}

/** 反驳分析 */
export type RebuttalStrength = 'weak' | 'moderate' | 'strong';

export interface BearPoint {
  point: string;
  evidence: string;
  probability: number; // %
  impact: string;
}

export interface BullVulnerability {
  originalPoint: string;
  vulnerability: string;
  counterCondition: string;
}

export interface RebuttalAnalysis {
  bullScore: number;
  bearScore: number;
  rebuttalStrength: RebuttalStrength;
  bearPoints: BearPoint[];
  bullVulnerabilities: BullVulnerability[];
  netEffect: 'unchanged' | 'downgraded' | 'significant_downgrade';
  adjustedScore?: number;
  tailRisks: TailRisk[];
}

/** 尾部风险 */
export interface TailRisk {
  risk: string;
  probability: number; // %
  impact: string;
  trigger: string;
  mitigation: string;
}

/** 情景分析 */
export interface Scenario {
  probability: number; // %
  description: string;
  indexPrice: string;  // SPX 目标
  nasdaqPrice: string; // IXIC 目标
  action: string;
  confidence: 'low' | 'moderate' | 'high';
}

export interface ScenarioWithTrigger extends Scenario {
  trigger: string;
}

export interface Scenarios {
  base: Scenario;
  upside: ScenarioWithTrigger;
  downside: ScenarioWithTrigger;
}

/** 校准上下文 */
export interface CalibrationContext {
  scoreRange: string;
  historicalAccuracy: number | null;
  systematicBias: string;
  sampleSize: number;
}

/** 短期策略 */
export interface ShortTermStrategy {
  horizon: 'short-term';
  action: string;
  spxEntryZone: string;
  ixicEntryZone: string;
  target: string;
  stopLoss: string;
  recommendedProduct: string;
  riskWarning: string;
}

/** 中长期策略 */
export interface MidTermStrategy {
  horizon: 'medium-term';
  investAdvice: {
    dipInvest: 'continue' | 'increase' | 'pause';
    positionAdjust: 'add' | 'reduce' | 'hold';
    recommendedFund: string;
  };
  keyLevels: {
    spxSupportZone: string;
    spxResistanceZone: string;
    ixicSupportZone: string;
    ixicResistanceZone: string;
  };
  assetAllocation: string;     // 股债配置建议
  riskWarning: string;
}

/** 长期展望 — 单期限 */
export type LongTermHorizonYears = 1 | 3 | 5;

export interface LongTermHorizonOutlook {
  years: LongTermHorizonYears;
  label: string;
  direction: Direction;
  biasScore: number;
  confidence: 'low' | 'moderate' | 'high';
  trendLabel: string;
  returnBand: string;
  drivers: string[];
  risks: string[];
  dcaAdvice: string;
}

/** 长期展望汇总 */
export interface LongTermOutlook {
  summary: string;
  horizons: LongTermHorizonOutlook[];
  disclaimer: string;
}

/** 完整分析报告 */
export interface SnpAnalysisReport {
  timestamp: string;
  marketData: import('./market.ts').MarketData;
  dataQuality: {
    overallConfidence: number;
    warnings: string[];
  };
  technical: TechnicalAnalysis;
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  etf: import('./etf.ts').EtfAnalysis;
  rebuttal: RebuttalAnalysis;
  tailRisks: TailRisk[];
  overall: {
    score: number;
    direction: Direction;
    scenarios: Scenarios;
    calibration: CalibrationContext;
    shortTerm: ShortTermStrategy;
    midTerm: MidTermStrategy;
  };
  longTermOutlook?: LongTermOutlook;
}

/** 分析报告存储记录 */
export interface AnalysisReportRecord {
  id: number;
  date: string;
  horizon: string;
  reportJson: string;
  overallScore: number;
  direction: Direction;
  createdAt: string;
}
