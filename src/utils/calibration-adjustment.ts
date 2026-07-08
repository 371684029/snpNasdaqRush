// 校准偏纠偏 — 纯函数，不依赖 LLM
//
// 当系统发现自身有统计偏（偏保守/偏乐观）时，用历史数据强制修正最终评分，
// 而非仅靠 prompt 提示 LLM 自行修正。样本不足 5 个时不调整。

/** 给定评分与校准上下文，返回偏纠偏后的评分 */
export function applyCalibrationBias(
  score: number,
  systematicBias: string | null,
  sampleSize: number,
): number {
  if (sampleSize < 5 || !systematicBias) return score;

  // 偏保守 → 上调；偏乐观 → 下调
  const isPessimistic =
    systematicBias.includes('保守') || systematicBias === 'pessimistic';
  const isOptimistic =
    systematicBias.includes('乐观') || systematicBias === 'optimistic';
  if (!isPessimistic && !isOptimistic) return score; // 'calibrated' / '校准良好'

  // 偏移量 = 基数 5 + 每 10 个样本 +2，上限 15 分
  const offset = Math.min(15, 5 + Math.floor(sampleSize / 10) * 2);

  if (isPessimistic) return Math.min(100, score + offset);
  // isOptimistic
  return Math.max(0, score - offset);
}

/** 动量校准：过去 N 日涨幅超过阈值时自动调整下行情景概率 */
export function momentumAdjustScenarios(
  upsideProb: number,
  downsideProb: number,
  spxChangePct: number | null,
): { upside: number; base: number; downside: number } {
  if (spxChangePct == null) return { upside: upsideProb, base: 100 - upsideProb - downsideProb, downside: downsideProb };

  let adjUpside = upsideProb;
  let adjDownside = downsideProb;

  // 过去 5 日涨幅 > 2%：动量偏多，降低下行概率
  if (spxChangePct > 2) {
    adjDownside = Math.max(10, adjDownside - 5);
    adjUpside = Math.min(40, adjUpside + 5);
  }
  // 过去 5 日跌幅 > 2%：动量偏空，降低上行概率
  else if (spxChangePct < -2) {
    adjUpside = Math.max(10, adjUpside - 5);
    adjDownside = Math.min(40, adjDownside + 5);
  }

  const adjBase = 100 - adjUpside - adjDownside;
  return { upside: adjUpside, base: adjBase, downside: adjDownside };
}
