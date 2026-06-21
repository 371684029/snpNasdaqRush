// ETF 相关类型定义

/** ETF 对比项 */
export interface EtfComparison {
  code: string;
  name: string;
  nav: number;            // 最新净值
  change1d: number;       // 当日涨跌 (%)
  change1w: number;       // 近1周涨跌 (%)
  change1m: number;       // 近1月涨跌 (%)
  changeYtd: number;      // 年初至今 (%)
  feeRate: number;        // 管理费率 (%)
  aum: number;            // 管理资产规模 (亿)
  avgVolume: number;      // 日均成交量
  premium: number;        // 溢价率 (%)
  dividendYield: number;  // 股息率 (%)
  recommendation: string; // 适用场景
}

/** ETF 推荐 */
export interface EtfRecommendation {
  coreHold: string;       // 核心持仓推荐
  growthFocus: string;    // 成长风格推荐
  valueFocus: string;     // 价值风格推荐
  dipBuy: string;         // 逢跌定投推荐
}

/** 估值判断 */
export interface Valuation {
  level: 'low' | 'fair' | 'high';
  indicator: string;      // 判断依据（如 CAPE、Fwd PE）
  action: string;         // 操作建议
}

/** 板块轮动分析 */
export interface SectorRotation {
  leading: string[];      // 领涨板块
  lagging: string[];      // 落后板块
  rotationSignal: string; // 轮动信号描述
  defensiveShift: boolean; // 是否转向防御
}

/** ETF 面分析结果 */
export interface EtfAnalysis {
  comparisons: EtfComparison[];
  recommendation: EtfRecommendation;
  valuation: Valuation;
  sectorRotation: SectorRotation;
}

/** ETF 净值存储记录 */
export interface EtfNavRecord {
  date: string;
  code: string;
  nav: number;
  changePct: number;
  volume: number | null;
  premium: number | null;
  createdAt: string;
}
