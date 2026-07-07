// 美股宏观阶段标签 — 纯本地规则，不依赖 LLM

import type { MarketData } from '../types/market.js';

export interface MacroRegime {
  /** 机器可读标签 */
  tag: string;
  /** 中文展示名 */
  label: string;
  /** 一句话说明 */
  description: string;
  /** 判定依据 */
  signals: string[];
}

/**
 * 根据市场数据（+ 可选 SPX 偏离 MA20%）判定当前宏观阶段。
 * 规则按优先级叠加，取得分最高者。
 *
 * 与 goldRush 的差异：
 * - 用 VIX 替代 TIPS 衡量风险环境
 * - 用 10Y-2Y 利率曲线 + VIX 替代 美元+TIPS 衡量宽松预期
 * - 用 SPX 偏离 MA20 替代 金价偏离
 */
export function detectMacroRegime(
  marketData: MarketData,
  spxDeviationPct: number | null = null,
): MacroRegime {
  const vix = marketData.vix?.value?.value ?? null;
  const dxyChange = marketData.dollarIndex?.value?.change ?? 0;
  const yield10y = marketData.usTreasury?.yield10y?.value ?? null;
  const yield2y = marketData.usTreasury?.yield2y?.value ?? null;
  const curveSpread =
    yield10y != null && yield2y != null ? yield10y - yield2y : null;

  const candidates: Array<{ score: number; regime: MacroRegime }> = [];

  // 危机模式：VIX 极端飙升
  if (vix != null && vix > 35) {
    candidates.push({
      score: 40 + vix,
      regime: {
        tag: 'crisis_mode',
        label: '危机模式',
        description: 'VIX 极端飙升，市场恐慌情绪主导，宜避险降仓、避免抄底。',
        signals: [`VIX ${vix.toFixed(1)} > 35`],
      },
    });
  }

  // 风险规避：VIX 高位
  if (vix != null && vix > 25 && vix <= 35) {
    candidates.push({
      score: 30 + vix,
      regime: {
        tag: 'risk_off',
        label: '风险规避段',
        description: 'VIX 处高位，资金流向防御资产，权益类易承压、宜控仓等波动回落。',
        signals: [`VIX ${vix.toFixed(1)} > 25`],
      },
    });
  }

  // 风险逆风（替代 goldRush 的 real_rate_headwind）：VIX 偏高但未到 risk_off
  if (vix != null && vix >= 20 && vix <= 25) {
    candidates.push({
      score: 22 + vix,
      regime: {
        tag: 'risk_headwind',
        label: '风险偏好压制',
        description: 'VIX 偏高，市场风险情绪降温，反弹易遇阻、追高需谨慎。',
        signals: [`VIX ${vix.toFixed(1)} ∈ [20, 25]`],
      },
    });
  }

  // 利率曲线倒挂：10Y-2Y < 0
  if (curveSpread != null && curveSpread < 0) {
    candidates.push({
      score: 28 + Math.abs(curveSpread),
      regime: {
        tag: 'yield_curve_inversion',
        label: '利率曲线倒挂',
        description: '10Y-2Y 收益率倒挂，历史经验指向经济衰退预期升温，中长期需警惕盈利下修。',
        signals: [
          `10Y ${yield10y != null ? yield10y.toFixed(2) : 'N/A'}%`,
          `2Y ${yield2y != null ? yield2y.toFixed(2) : 'N/A'}%`,
          `利差 ${curveSpread.toFixed(2)}% < 0`,
        ],
      },
    });
  }

  // 宽松预期观察（替代 goldRush 的 dovish_pivot_watch）：曲线正常 + VIX 偏低
  if (curveSpread != null && curveSpread > 0 && vix != null && vix < 18) {
    candidates.push({
      score: 26,
      regime: {
        tag: 'dovish_pivot_watch',
        label: '宽松预期升温',
        description: '利率曲线正常且 VIX 偏低，市场对降息预期定价升温，利于估值修复。',
        signals: [
          `利差 ${curveSpread.toFixed(2)}% > 0`,
          `VIX ${vix.toFixed(1)} < 18`,
        ],
      },
    });
  }

  // 低波动上行：VIX 极低
  if (vix != null && vix < 14) {
    candidates.push({
      score: 24 + (14 - vix),
      regime: {
        tag: 'low_vol_rally',
        label: '低波动上行段',
        description: 'VIX 处低位，市场情绪乐观，趋势性行情易延续但需警惕拥挤交易。',
        signals: [`VIX ${vix.toFixed(1)} < 14`],
      },
    });
  }

  // SPX 超卖修复
  if (spxDeviationPct != null && spxDeviationPct <= -5) {
    candidates.push({
      score: 25 + Math.abs(spxDeviationPct),
      regime: {
        tag: 'oversold_repair',
        label: '超卖修复段',
        description: 'SPX 显著低于 MA20，技术性反弹概率上升，但趋势未必反转。',
        signals: [`SPX 偏离 MA20 ${spxDeviationPct.toFixed(1)}%`],
      },
    });
  }

  // SPX 偏离过热
  if (spxDeviationPct != null && spxDeviationPct >= 8) {
    candidates.push({
      score: 20 + spxDeviationPct,
      regime: {
        tag: 'extended_rally',
        label: '偏离过热段',
        description: 'SPX 显著高于 MA20，追高风险上升，定投宜控节奏、分批介入。',
        signals: [`SPX 偏离 MA20 +${spxDeviationPct.toFixed(1)}%`],
      },
    });
  }

  // 美元走强段（保留 goldRush 的逻辑，对美股亦有压制）
  if (dxyChange > 0.4) {
    candidates.push({
      score: 18 + Math.abs(dxyChange),
      regime: {
        tag: 'dollar_strength',
        label: '美元走强段',
        description: '美元指数上行压制跨国企业盈利换算，需关注反弹持续性。',
        signals: [`美元 ${dxyChange > 0 ? '+' : ''}${dxyChange.toFixed(2)}%`],
      },
    });
  }

  if (candidates.length === 0) {
    return {
      tag: 'range_bound',
      label: '震荡整理',
      description: '宏观信号未形成单一主导因素，宜区间思维、定投纪律为主。',
      signals: ['VIX/利率曲线/SPX 偏离度均未触发极端阈值'],
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].regime;
}

/** CLI / Markdown 单行 */
export function formatMacroRegimeLine(regime: MacroRegime): string {
  return `${regime.label}（${regime.tag}）— ${regime.description}`;
}