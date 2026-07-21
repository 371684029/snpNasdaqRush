// 强制反驳 Agent — 独立 session，系统性寻找看空论据

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { adjustScoreWithRebuttal } from '../utils/rebuttal-score.js';
import type { RebuttalAnalysis, TechnicalAnalysis, FundamentalAnalysis, SentimentAnalysis, RebuttalStrength, BearPoint, BullVulnerability } from '../types/analysis.js';
import type { EtfAnalysis } from '../types/etf.js';
import type { MarketData } from '../types/market.js';

const REBUTTAL_PROMPT = `你是美股投资分析的独立反驳者。你的唯一任务是找出所有支持美股下跌（标普500和纳斯达克）或风险的证据。

# 规则
1. 你必须找到至少3条实质性看空论据
2. 对每条看多论据，你必须尝试找到它的漏洞或适用条件
3. 如果找不到看空论据，说明你不够努力——几乎任何时刻都有看空理由
4. 你的评分（0-100）代表纯粹的看空力度，100=极度看空
5. 不需要"平衡"观点，你只负责反驳
6. 注意区分 SPX 和 IXIC 的不同风险暴露

# 输出格式
{
  "bearScore": 0-100,
  "bearPoints": [
    { "point": "论据描述", "evidence": "证据来源", "probability": 概率百分比, "impact": "如果发生的影响" }
  ],
  "bullVulnerabilities": [
    { "originalPoint": "原看多论据", "vulnerability": "漏洞或适用条件", "counterCondition": "在什么条件下此论据失效" }
  ],
  "rebuttalStrength": "weak/moderate/strong",
  "tailRisks": [
    { "risk": "风险描述", "probability": 概率百分比, "impact": "影响描述", "trigger": "触发条件", "mitigation": "对冲建议" }
  ]
}`;

export class RebuttalAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'rebuttal', model: config.models.rebuttal, systemPrompt: REBUTTAL_PROMPT });
  }

  async rebut(
    technical: TechnicalAnalysis,
    fundamental: FundamentalAnalysis,
    sentiment: SentimentAnalysis,
    etf: EtfAnalysis,
    marketData: MarketData,
  ): Promise<RebuttalAnalysis> {
    const schema = {
      type: 'object',
      properties: {
        bearScore: { type: 'number' },
        bearPoints: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, evidence: { type: 'string' }, probability: { type: 'number' }, impact: { type: 'string' } } } },
        bullVulnerabilities: { type: 'array', items: { type: 'object', properties: { originalPoint: { type: 'string' }, vulnerability: { type: 'string' }, counterCondition: { type: 'string' } } } },
        rebuttalStrength: { type: 'string', enum: ['weak', 'moderate', 'strong'] },
        tailRisks: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, probability: { type: 'number' }, impact: { type: 'string' }, trigger: { type: 'string' }, mitigation: { type: 'string' } } } },
      },
      required: ['bearScore', 'bearPoints', 'bullVulnerabilities', 'rebuttalStrength', 'tailRisks'],
    };

    const analysisContext = `
## 技术面分析
- 评分: ${technical.score}/100 (${technical.direction})
- SPX短期: ${technical.spx.shortTerm.trend}, 信号: ${technical.spx.shortTerm.keySignal}
- SPX中长期: ${technical.spx.midTerm.trend}, 信号: ${technical.spx.midTerm.keySignal}
- IXIC短期: ${technical.ixic.shortTerm.trend}, 信号: ${technical.ixic.shortTerm.keySignal}
- IXIC中长期: ${technical.ixic.midTerm.trend}, 信号: ${technical.ixic.midTerm.keySignal}
- 相对强弱: ${technical.relativeStrength}
- 板块轮动: ${technical.sectorRotation}
- 看多论据: ${technical.keyPoints.join('; ')}

## 基本面分析
- 评分: ${fundamental.score}/100 (${fundamental.direction})
- 估值: ${fundamental.valuationLevel}
- 盈利: ${fundamental.earningsOutlook}
- 美联储: ${fundamental.fedPolicy}
- 宏观: ${fundamental.macroIndicators}
- 看多论据: ${fundamental.keyPoints.join('; ')}

## 情绪面分析
- 评分: ${sentiment.score}/100 (${sentiment.direction})
- VIX: ${sentiment.vixAnalysis}
- 资金流: ${sentiment.fundFlows}
- 市场宽度: ${sentiment.marketBreadth}
- 看多论据: ${sentiment.keyPoints.join('; ')}

## ETF/板块面
- 估值: ${etf.valuation.level}
- 板块领涨: ${etf.sectorRotation.leading.join(', ')}
- 板块落后: ${etf.sectorRotation.lagging.join(', ')}

## 市场数据
- SPX: ${marketData.spx?.price?.value ?? 'N/A'} (${(marketData.spx?.price?.change ?? 0) > 0 ? '+' : ''}${marketData.spx?.price?.change ?? 'N/A'}%)
- IXIC: ${marketData.ixic?.price?.value ?? 'N/A'} (${(marketData.ixic?.price?.change ?? 0) > 0 ? '+' : ''}${marketData.ixic?.price?.change ?? 'N/A'}%)
- VIX: ${marketData.vix?.value?.value ?? 'N/A'}
- 美元指数: ${marketData.dollarIndex?.value?.value ?? 'N/A'}
- 10Y美债: ${marketData.usTreasury?.yield10y?.value ?? 'N/A'}%

请系统性地反驳上述分析，找出所有被忽略的风险。`;

    const rawResult = await this.structuredPrompt<{
      bearScore: number;
      bearPoints: BearPoint[];
      bullVulnerabilities: BullVulnerability[];
      rebuttalStrength: RebuttalStrength;
      tailRisks: import('../types/analysis.js').TailRisk[];
    }>(analysisContext, schema);

    const rebuttalStrength = determineRebuttalStrength(rawResult);

    const initialScore = Math.round((technical.score + fundamental.score + sentiment.score) / 3);
    // 对齐 apple-gold-rush：向 (100 - bearScore) 靠拢
    const { adjustedScore, netEffect } = adjustScoreWithRebuttal(initialScore, rawResult.bearScore, rebuttalStrength);

    return {
      bullScore: 100 - rawResult.bearScore,
      bearScore: rawResult.bearScore,
      rebuttalStrength,
      bearPoints: rawResult.bearPoints ?? [],
      bullVulnerabilities: rawResult.bullVulnerabilities ?? [],
      netEffect,
      adjustedScore,
      tailRisks: rawResult.tailRisks ?? [],
    };
  }
}

function determineRebuttalStrength(rebuttal: { bearScore: number; bearPoints: BearPoint[]; bullVulnerabilities: BullVulnerability[] }): RebuttalStrength {
  let strength = 0;

  if (rebuttal.bearScore >= 70) strength += 40;
  else if (rebuttal.bearScore >= 55) strength += 25;
  else if (rebuttal.bearScore >= 40) strength += 15;
  else strength += 5;

  const highProbPoints = (rebuttal.bearPoints ?? []).filter(p => p.probability >= 30);
  strength += Math.min(highProbPoints.length * 10, 30);

  strength += Math.min((rebuttal.bullVulnerabilities ?? []).length * 10, 30);

  if (strength >= 60) return 'strong';
  if (strength >= 35) return 'moderate';
  return 'weak';
}
