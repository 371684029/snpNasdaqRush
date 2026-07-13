// 自然语言建议 — 评分 → 人话
// 对齐 goldRush plain-advice.ts

export interface PlainAdvice {
  emoji: string;
  label: string;
  headline: string;
  action: string;
  color: string;
  level: number; // 0=强空, 1=弱空, 2=中性, 3=弱多, 4=强多
}

export function scoreToAdvice(score: number, direction?: string): PlainAdvice {
  const d = direction || (score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral');
  if (score >= 80) return { emoji: '🚀', label: '强烈偏多', headline: '多项指标共振看多', action: '可适度加仓；回调至均线支撑位是加码机会', color: '#22c55e', level: 4 };
  if (score >= 65 && d === 'bullish') return { emoji: '📈', label: '偏多', headline: '短期动能偏强', action: '维持仓位；回调至支撑位可小幅加仓，高位不追', color: '#22c55e', level: 3 };
  if (score >= 50) return { emoji: '➡️', label: '中性偏多', headline: '震荡偏强，方向待确认', action: '维持现有仓位，按纪律执行；等待更明确信号', color: '#f59e0b', level: 2 };
  if (score >= 35) return { emoji: '⚠️', label: '中性偏空', headline: '风险升温，谨慎为上', action: '仓位控制在 50% 以下；暂停加仓，设置紧密止损', color: '#f59e0b', level: 1 };
  return { emoji: '🔴', label: '偏空', headline: '下行风险大于反弹空间', action: '减仓至 30% 以下；清仓高 beta 品种；等评分回升再入场', color: '#ef4444', level: 0 };
}

export interface ConsistencyCheck {
  consensus: 'bullish' | 'bearish' | 'mixed';
  agreedCount: number;
  dissenters: string[];
  strength: 'strong' | 'moderate' | 'weak';
}

export function checkConsistency(
  technical: { score: number; direction: string },
  fundamental: { score: number; direction: string },
  sentiment: { score: number; direction: string },
): ConsistencyCheck {
  const dims = [
    { name: '技术面', score: technical.score, direction: technical.direction },
    { name: '基本面', score: fundamental.score, direction: fundamental.direction },
    { name: '情绪面', score: sentiment.score, direction: sentiment.direction },
  ];
  const bullish = dims.filter(d => d.direction === 'bullish');
  const bearish = dims.filter(d => d.direction === 'bearish');

  let consensus: 'bullish' | 'bearish' | 'mixed';
  let agreedCount: number;
  let strength: 'strong' | 'moderate' | 'weak';

  if (bullish.length >= 2) {
    consensus = 'bullish';
    agreedCount = bullish.length;
    strength = bullish.length === 3 ? 'strong' : 'moderate';
  } else if (bearish.length >= 2) {
    consensus = 'bearish';
    agreedCount = bearish.length;
    strength = bearish.length === 3 ? 'strong' : 'moderate';
  } else {
    consensus = 'mixed';
    agreedCount = 0;
    strength = 'weak';
  }

  const dissenters = dims
    .filter(d => d.direction !== (consensus === 'bullish' ? 'bullish' : consensus === 'bearish' ? 'bearish' : ''))
    .map(d => d.name);

  return { consensus, agreedCount, dissenters, strength };
}
