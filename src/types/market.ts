// 市场数据类型定义 — 标普500 & 纳斯达克

/** 来源可信度等级 */
export type SourceGrade = 'A' | 'B' | 'C';

/** 带来源标注的数据点 */
export interface SourcedValue<T> {
  value: T;
  source: string;
  sourceGrade: SourceGrade;
  verifiedAt: string; // ISO datetime
}

/** 带涨跌幅的数据点 */
export interface SourcedPrice extends SourcedValue<number> {
  change: number; // 涨跌幅 (%)
}

/** 指数数据 */
export interface IndexData {
  price: SourcedPrice;   // 指数点位
  high?: SourcedValue<number>;
  low?: SourcedValue<number>;
  pe?: SourcedValue<number>;      // 市盈率
  dividend?: SourcedValue<number>; // 股息率
}

/** ETF 数据 */
export interface EtfData {
  code: string;          // ETF 代码 (SPY/QQQ/VOO)
  name: string;
  nav: SourcedPrice;     // 最新净值
  premiumDiscount?: SourcedValue<number>; // 溢价/折价率 (%)
  ytdReturn?: SourcedValue<number>;      // 年初至今收益
}

/** VIX 波动率数据 */
export interface VixData {
  value: SourcedPrice;
}

/** 美元指数 */
export interface DollarIndexData {
  value: SourcedPrice;
}

/** 美债收益率 */
export interface UsTreasuryData {
  yield10y: SourcedPrice; // 10年期美债收益率 (%)
  yield2y: SourcedPrice;  // 2年期美债收益率 (%)
  tips10y?: SourcedValue<number>; // 10年期 TIPS 实际利率 (%)
}

/** 完整市场数据 */
export interface MarketData {
  timestamp: string;     // 数据采集时间 ISO datetime
  spx: IndexData;        // 标普500
  ixic: IndexData;       // 纳斯达克综合指数
  spy: EtfData;          // SPY (标普500 ETF)
  qqq: EtfData;          // QQQ (纳斯达克100 ETF)
  voo?: EtfData;         // VOO (先锋标普500 ETF)
  vix: VixData;          // VIX 恐慌指数
  dollarIndex: DollarIndexData;
  usTreasury: UsTreasuryData;
}

/** 验证结果 */
export interface ValidationSource {
  value: number | string;
  source: string;
  grade: SourceGrade;
  timestamp: string;
}

export type ValidationConsensus = 'verified' | 'single_source' | 'minor_deviation' | 'major_conflict';

export interface ValidationResult {
  field: string;
  sources: ValidationSource[];
  consensus: ValidationConsensus;
  finalValue: number | string;
  confidence: number; // 0-100
}

/** SQLite 指数快照记录 */
export interface IndexPriceRecord {
  date: string;          // YYYY-MM-DD
  spxClose: number | null;
  spxHigh: number | null;
  spxLow: number | null;
  spxPe: number | null;
  ixicClose: number | null;
  ixicHigh: number | null;
  ixicLow: number | null;
  spyNav: number | null;
  spyChange: number | null;
  qqqNav: number | null;
  qqqChange: number | null;
  vix: number | null;
  dollarIndex: number | null;
  us10yYield: number | null;
  us2yYield: number | null;
  tipsYield: number | null;
  createdAt: string;
}

/** 搜索引擎类型 */
export type SearchEngine = 'tavily' | 'opencode' | 'unknown';

/** 搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: SearchEngine;
  publishedDate?: string;
  sourceGrade?: SourceGrade;
}

/** 搜索选项 */
export interface SearchOptions {
  engine: SearchEngine;
  numResults?: number;
  useCache?: boolean;
}

/** 交易时段 */
export type TradingSession = 'pre_market' | 'day' | 'after_hours' | 'closed';

/** 交易时间判断结果 */
export interface TradingTimeInfo {
  session: TradingSession;
  description: string;
  isTradingDay: boolean;
}
