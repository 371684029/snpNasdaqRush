// 强制反驳 Agent — 独立 session，系统性寻找看空论据

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { adjustScoreWithRebuttal } from '../utils/rebuttal-score.js';
import type { RebuttalAnalysis, TechnicalAnalysis, FundamentalAnalysis, SentimentAnalysis, Direction, RebuttalStrength, BearPoint, BullVulnerability } from '../types/analysis.js';
import type { EtfAnalysis } from '../types/etf.js';
import type { MarketData } from '../types/market.js';

const REBUTTAL_PROMPT = `你是美股投资分析的独立反驳者。你的任务是严格审查看多论据的漏洞，而非罗列通用看空理由。

# 核心要求
1. 你收到的"技术面/基本面/情绪面"已经包含了看多分析。你的工作是为这些看多论据找漏洞
2. 对每条看多论据（keyPoints），你必须至少回答：它在什么条件下会失效？
3. 如果某些看多论据在历史上反复出现但现在可能不适用了，这是最重要的漏洞
4. bearScore（0-100）代表你找到的看多漏洞的严重程度，而非情绪感受
5. 至少找到 3 个 bullVulnerabilities（看多漏洞），每个对应一个原始看多论据
6. 必须包含 tailRisks（尾部风险），至少 2 条
7. 注意区分 SPX 和 IXIC 的不同风险暴露

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
### 需严格审查的看多论据（每条都要找漏洞）:
${technical.keyPoints.map((kp, i) => `  ${i + 1}. ${kp}`).join('\n')}

## 基本面分析
- 评分: ${fundamental.score}/100 (${fundamental.direction})
- 估值: ${fundamental.valuationLevel}
- 盈利: ${fundamental.earningsOutlook}
- 美联储: ${fundamental.fedPolicy}
- 宏观: ${fundamental.macroIndicators}
### 需严格审查的看多论据:
${fundamental.keyPoints.map((kp, i) => `  ${i + 1}. ${kp}`).join('\n')}

## 情绪面分析
- 评分: ${sentiment.score}/100 (${sentiment.direction})
- VIX: ${sentiment.vixAnalysis}
- 资金流: ${sentiment.fundFlows}
- 市场宽度: ${sentiment.marketBreadth}
### 需严格审查的看多论据:
${sentiment.keyPoints.map((kp, i) => `  ${i + 1}. ${kp}`).join('\n')}

## ETF/板块面
- 估值: ${etf.valuation.level}
- 板块领涨: ${etf.sectorRotation.leading.join(', ')}
- 板块落后: ${etf.sectorRotation.lagging.join(', ')}

## 市场数据
- SPX: ${marketData.spx.price?.value} (${marketData.spx.price?.change > 0 ? '+' : ''}${marketData.spx.price?.change}%)
- IXIC: ${marketData.ixic.price?.value} (${marketData.ixic.price?.change > 0 ? '+' : ''}${marketData.ixic.price?.change}%)
- VIX: ${marketData.vix.value?.value}
- 美元指数: ${marketData.dollarIndex.value?.value}
- 10Y美债: ${marketData.usTreasury.yield10y?.value}%

对上述每条看多论据，找出它的漏洞或失效条件（bullVulnerabilities）。不要重复罗列通用看空风险——每条 bullVulnerability 必须对应一个具体的原始看多论据。`;

    const rawResult = await this.structuredPrompt<{
      bearScore: number;
      bearPoints: BearPoint[];
      bullVulnerabilities: BullVulnerability[];
      rebuttalStrength: RebuttalStrength;
      tailRisks: import('../types/analysis.js').TailRisk[];
    }>(analysisContext, schema);

    const rebuttalStrength = determineRebuttalStrength(rawResult);

    const initialScore = Math.round((technical.score + fundamental.score + sentiment.score) / 3);
    // 使用 utils/rebuttal-score.ts 的统一公式，删除本地重复实现
    const { adjustedScore, netEffect } = adjustScoreWithRebuttal(initialScore, rawResult.bearScore, rebuttalStrength);

    return {
      bullScore: 100 - rawResult.bearScore,
      bearScore: rawResult.bearScore,
      rebuttalStrength,
      bearPoints: rawResult.bearPoints,
      bullVulnerabilities: rawResult.bullVulnerabilities,
      netEffect,
      adjustedScore,
      tailRisks: rawResult.tailRisks,
    };
  }
}

function determineRebuttalStrength(rebuttal: { bearScore: number; bearPoints: BearPoint[]; bullVulnerabilities: BullVulnerability[] }): RebuttalStrength {
  let strength = 0;

  if (rebuttal.bearScore >= 70) strength += 40;
  else if (rebuttal.bearScore >= 55) strength += 25;
  else if (rebuttal.bearScore >= 40) strength += 15;
  else strength += 5;

  const highProbPoints = rebuttal.bearPoints.filter(p => p.probability >= 30);
  strength += Math.min(highProbPoints.length * 10, 30);

  strength += Math.min(rebuttal.bullVulnerabilities.length * 10, 30);

  if (strength >= 60) return 'strong';
  if (strength >= 35) return 'moderate';
  return 'weak';
}
