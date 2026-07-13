// 美股因果关系规则 — 基于宏观/市场信号匹配因果，降低 LLM 幻觉
// 对齐 goldRush gold-causal-rules.ts 的设计

export interface CausalRule {
  id: string;
  label: string;
  test: (ctx: CausalContext) => boolean;
  effect: string;
  confidence: number; // 0-1
  conditions: string[];
  counterConditions: string[];
}

export interface CausalContext {
  dollarDirection: 'up' | 'down' | 'flat';
  dollarMagnitude: number;
  yield10y: number | null;
  yield2y: number | null;
  vix: number | null;
  spxChange: number | null; // daily %
  macroRegime: string | null;
}

const RULES: CausalRule[] = [
  {
    id: 'dollar_weak_spx_up',
    label: '美元走弱 → 美股受益',
    test: (ctx) => ctx.dollarDirection === 'down' && ctx.dollarMagnitude > 0.3,
    effect: '弱势美元降低跨国企业汇兑损失，提升海外收入折算价值，利好 SPX 中大型跨国公司',
    confidence: 0.72,
    conditions: ['美元指数近 5 日趋势向下', '跌幅 >0.3%'],
    counterConditions: ['若美元走弱源于美国衰退预期则失效', '若地缘冲突导致避险美元回流则失效'],
  },
  {
    id: 'yield_inversion_recession',
    label: '收益率曲线倒挂 → 衰退预警',
    test: (ctx) => ctx.yield2y != null && ctx.yield10y != null && ctx.yield2y > ctx.yield10y,
    effect: '2Y-10Y 倒挂历史上领先衰退 6-18 个月，当前周期倒挂持续意味着远期经济预期悲观',
    confidence: 0.78,
    conditions: ['2Y 收益率 > 10Y 收益率（倒挂）', '已持续 ≥1 个月'],
    counterConditions: ['若倒挂源于美联储前瞻指引而非基本面则威力减弱', '若通胀快速回落可软着陆'],
  },
  {
    id: 'vix_low_complacency',
    label: 'VIX 极端低位 → 波动率爆发风险',
    test: (ctx) => ctx.vix != null && ctx.vix < 15,
    effect: 'VIX 低于 15 表明市场过度自满，历史上极低波动后均出现剧烈波动回归',
    confidence: 0.75,
    conditions: ['VIX < 15', '连续 ≥3 日维持低位'],
    counterConditions: ['若伴随企业盈利超预期增长可维持较长时间', 'CTA 系统性卖出波动可能拉长低波周期'],
  },
  {
    id: 'vix_spike_fear',
    label: 'VIX 飙升 → 恐慌抛售',
    test: (ctx) => ctx.vix != null && ctx.vix > 28,
    effect: 'VIX > 28 表示市场恐慌，短期可能出现踩踏式抛售，但也可能接近阶段性底部',
    confidence: 0.68,
    conditions: ['VIX > 28', '过去 3 日涨幅 >30%'],
    counterConditions: ['若 VIX 飙升源于事件驱动（非系统性风险）可能是买入机会', '若伴随流动性危机则可能进一步恶化'],
  },
  {
    id: 'rate_divergence_tech_pressure',
    label: '利率分化 → 科技股承压',
    test: (ctx) => ctx.yield10y != null && ctx.yield10y > 4.5 && ctx.dollarDirection === 'up',
    effect: '高利率+强美元组合对成长型科技股（IXIC）估值形成双重压制，DCF 模型分母上升',
    confidence: 0.70,
    conditions: ['10Y > 4.5%', '美元指数走强'],
    counterConditions: ['若 AI 叙事带来盈利超预期增长可对冲估值压力', '若利率上行源于增长预期而非通胀则影响有限'],
  },
  {
    id: 'bull_steepening_risk_on',
    label: '收益率曲线陡峭化 → 风险偏好回升',
    test: (ctx) => {
      if (ctx.yield10y == null || ctx.yield2y == null) return false;
      const spread = ctx.yield10y - ctx.yield2y;
      return spread > 0.3 && ctx.yield2y < ctx.yield10y;
    },
    effect: '利差扩大（牛陡）通常反映市场对未来增长信心增强，利好周期性板块和中小盘',
    confidence: 0.65,
    conditions: ['10Y-2Y 利差 >0.3%', '短端利率稳定或下降'],
    counterConditions: ['若陡峭化源于长端通胀补偿而非增长预期则偏中性', '若伴随信用利差扩大则是滞胀信号'],
  },
];

export function matchCausalRules(ctx: CausalContext): CausalRule[] {
  return RULES.filter(r => r.test(ctx));
}

export function formatCausalChainsConsole(rules: CausalRule[]): string {
  if (!rules.length) return '';
  const lines: string[] = ['', '  🔗 因果链'];
  for (const r of rules) {
    lines.push(`  ${r.label} (${Math.round(r.confidence * 100)}%)`);
    lines.push(`    → ${r.effect}`);
  }
  return lines.join('\n');
}

export function formatCausalChainsMarkdown(rules: CausalRule[]): string[] {
  if (!rules.length) return [];
  const lines: string[] = ['## 🔗 因果链', ''];
  for (const r of rules) {
    lines.push(`- **${r.label}** (置信 ${Math.round(r.confidence * 100)}%)`);
    lines.push(`  - 因果: ${r.effect}`);
    lines.push(`  - 条件: ${r.conditions.join('；')}`);
    lines.push(`  - 反制: ${r.counterConditions.join('；')}`);
    lines.push('');
  }
  return lines;
}
