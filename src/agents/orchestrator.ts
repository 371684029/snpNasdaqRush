// 综合编排 Agent — 汇总四维度 + 反驳 + 校准 + 双轨策略

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { CalibrationRepo } from '../db/calibration.js';
import { ScenarioFeaturesRepo } from '../db/scenario-features.js';
import { ReportsRepo } from '../db/reports.js';
import { resolveOverallScore, enforceOverallScore } from '../utils/overall-score.js';
import type { TechnicalAnalysis, FundamentalAnalysis, SentimentAnalysis, Direction, ShortTermStrategy, MidTermStrategy, Scenarios, RebuttalAnalysis, SnpAnalysisReport } from '../types/analysis.js';
import type { MarketData } from '../types/market.js';
import type { EtfAnalysis } from '../types/etf.js';
import type { QuantScoreResult } from '../indicators/quant-score.js';

const ORCHESTRATOR_PROMPT = `你是美股投资研究综合编排师。你将汇总技术面、基本面、情绪面、ETF/板块面四维度分析，结合反驳分析和校准数据，输出双视角策略报告。

## 双视角分析规则

### 短期视角（日线级别，持仓数天~2周）
- 操作品种：SPY、QQQ 场内ETF
- 入场信号：日线MACD金叉、RSI超卖回升等
- 出场策略：目标位止盈 + 固定止损(3-5%)
- 快进快出，不恋战

### 中长期视角（周线级别，持仓1~6个月）
- 第一层：核心持仓（60-70%）— SPY/VOO 定投
- 第二层：卫星配置（30-40%）— QQQ 等成长暴露
- 风控：估值止盈、仓位管理

## 情景分析要求
你必须输出三个情景（基准/上行/下行），而非单一预测：
1. 基准情景：最可能发生的路径（概率45-60%）
2. 上行情景：超预期情景（概率15-30%）
3. 下行情景：不及预期情景（概率15-30%，不得低于15%）

规则：
- 三个概率之和 = 100%
- 每个情景必须有明确的触发条件
- 下行情景的概率不得低于15%

## 反驳结果处理
1. 如果反驳强度≥中等，在风险提示中突出看空论据
2. 不得忽略反驳结果
3. 评分应考虑反驳修正

## 输出格式（严格遵守，直接输出JSON，不要用markdown代码块）
{
  "overall": {
    "score": 数字(0-100),
    "direction": "bullish/bearish/neutral",
    "scenarios": {
      "base": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "action": "字符串", "confidence": "low/moderate/high" },
      "upside": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "trigger": "字符串", "action": "字符串", "confidence": "low/moderate/high" },
      "downside": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "trigger": "字符串", "action": "字符串", "confidence": "low/moderate/high" }
    },
    "shortTerm": {
      "horizon": "short-term",
      "action": "字符串",
      "spxEntryZone": "SPX入场区间",
      "ixicEntryZone": "IXIC入场区间",
      "target": "目标位",
      "stopLoss": "止损位",
      "recommendedProduct": "推荐品种",
      "riskWarning": "风险提示"
    },
    "midTerm": {
      "horizon": "medium-term",
      "investAdvice": { "dipInvest": "continue/increase/pause", "positionAdjust": "add/reduce/hold", "recommendedFund": "推荐配置" },
      "keyLevels": { "spxSupportZone": "SPX支撑区", "spxResistanceZone": "SPX阻力区", "ixicSupportZone": "IXIC支撑区", "ixicResistanceZone": "IXIC阻力区" },
      "assetAllocation": "股债配置建议",
      "riskWarning": "风险提示"
    }
  }
}`;

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'orchestrator', model: config.models.orchestrator, systemPrompt: ORCHESTRATOR_PROMPT });
  }

  async orchestrate(
    marketData: MarketData,
    technical: TechnicalAnalysis,
    fundamental: FundamentalAnalysis,
    sentiment: SentimentAnalysis,
    etf: EtfAnalysis,
    rebuttal: RebuttalAnalysis,
    horizon: 'short' | 'mid' | 'all' = 'all',
    quantScore?: number,
    quantFactors?: QuantScoreResult['factors'],
  ): Promise<SnpAnalysisReport> {
    const db = getDb();
    const calibrationRepo = new CalibrationRepo(db);
    const finalScore = resolveOverallScore(rebuttal, {
      technical: technical.score,
      fundamental: fundamental.score,
      sentiment: sentiment.score,
    });
    const calibrationContext = calibrationRepo.getCalibrationContext(finalScore);

    try {
      calibrationRepo.backfillPending();
    } catch { /* ignore */ }

    let calibrationText = '校准数据不足（样本<5），暂无统计参考';
    if (calibrationContext && calibrationContext.historicalAccuracy !== null) {
      calibrationText = `评分${calibrationContext.scoreRange}区间：历史${calibrationContext.sampleSize}次分析，实际涨概率${Math.round(calibrationContext.historicalAccuracy * 100)}%，系统偏差：${calibrationContext.systematicBias}`;
    }

    const schema = {
      type: 'object',
      properties: {
        overall: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
            scenarios: {
              type: 'object',
              properties: {
                base: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
                upside: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, trigger: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
                downside: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, trigger: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
              },
            },
            shortTerm: {
              type: 'object',
              properties: {
                horizon: { type: 'string' }, action: { type: 'string' },
                spxEntryZone: { type: 'string' }, ixicEntryZone: { type: 'string' },
                target: { type: 'string' }, stopLoss: { type: 'string' },
                recommendedProduct: { type: 'string' }, riskWarning: { type: 'string' },
              },
            },
            midTerm: {
              type: 'object',
              properties: {
                horizon: { type: 'string' },
                investAdvice: { type: 'object', properties: { dipInvest: { type: 'string' }, positionAdjust: { type: 'string' }, recommendedFund: { type: 'string' } } },
                keyLevels: { type: 'object', properties: { spxSupportZone: { type: 'string' }, spxResistanceZone: { type: 'string' }, ixicSupportZone: { type: 'string' }, ixicResistanceZone: { type: 'string' } } },
                assetAllocation: { type: 'string' },
                riskWarning: { type: 'string' },
              },
            },
          },
        },
      },
      required: ['overall'],
    };

    const spxPrice = marketData.spx?.price?.value ?? 'N/A';
    const spxChg = marketData.spx?.price?.change;
    const ixicPrice = marketData.ixic?.price?.value ?? 'N/A';
    const ixicChg = marketData.ixic?.price?.change;
    const vix = marketData.vix?.value?.value ?? 'N/A';
    const dxy = marketData.dollarIndex?.value?.value ?? 'N/A';
    const y10 = marketData.usTreasury?.yield10y?.value ?? 'N/A';
    const y2 = marketData.usTreasury?.yield2y?.value ?? 'N/A';
    const bearPoints = rebuttal.bearPoints ?? [];

    const prompt = `## 市场数据
SPX: ${spxPrice} (${typeof spxChg === 'number' ? (spxChg > 0 ? '+' : '') + spxChg : 'N/A'}%)
IXIC: ${ixicPrice} (${typeof ixicChg === 'number' ? (ixicChg > 0 ? '+' : '') + ixicChg : 'N/A'}%)
VIX: ${vix}
美元指数: ${dxy}
10Y美债: ${y10}%
2Y美债: ${y2}%

## 技术面 (${technical.score}/100 ${technical.direction})
SPX短期: ${technical.spx?.shortTerm?.trend ?? 'N/A'}, ${technical.spx?.shortTerm?.keySignal ?? 'N/A'}
SPX中长期: ${technical.spx?.midTerm?.trend ?? 'N/A'}, ${technical.spx?.midTerm?.keySignal ?? 'N/A'}
IXIC短期: ${technical.ixic?.shortTerm?.trend ?? 'N/A'}, ${technical.ixic?.shortTerm?.keySignal ?? 'N/A'}
IXIC中长期: ${technical.ixic?.midTerm?.trend ?? 'N/A'}, ${technical.ixic?.midTerm?.keySignal ?? 'N/A'}
相对强弱: ${technical.relativeStrength ?? 'N/A'}
板块轮动: ${technical.sectorRotation ?? 'N/A'}

## 基本面 (${fundamental.score}/100 ${fundamental.direction})
${(fundamental.keyPoints ?? []).join('; ') || 'N/A'}

## 情绪面 (${sentiment.score}/100 ${sentiment.direction})
${(sentiment.keyPoints ?? []).join('; ') || 'N/A'}

## ETF/板块面
估值: ${etf.valuation?.level ?? 'N/A'}, 板块领涨: ${(etf.sectorRotation?.leading ?? []).join(', ') || 'N/A'}

## 反驳分析
看空力度: ${rebuttal.bearScore}/100 (强度: ${rebuttal.rebuttalStrength})
看空论据: ${bearPoints.map(p => p.point).join('; ') || 'N/A'}
评分修正: ${rebuttal.adjustedScore ?? '未修正'} (${rebuttal.netEffect ?? 'N/A'})
${quantScore != null ? `\n## 本地量化分\n量化综合分: ${quantScore}/100（仅供参考，最终综合分以反驳修正为准）\n` : ''}
## 历史校准
${calibrationText}

## 输出视角
${horizon === 'short' ? '仅短期视角' : horizon === 'mid' ? '仅中长期视角' : '双视角（短期+中长期）'}

请输出综合研判报告，包含情景分析和双轨策略。`;

    const result = await this.structuredPrompt<{
      overall: {
        score: number;
        direction: Direction;
        scenarios: Scenarios;
        shortTerm: ShortTermStrategy;
        midTerm: MidTermStrategy;
      };
    }>(prompt, schema);

    const enforcedScore = enforceOverallScore(result.overall.score, finalScore);

    const report: SnpAnalysisReport = {
      timestamp: new Date().toISOString(),
      marketData,
      dataQuality: {
        overallConfidence: 80,
        warnings: [],
      },
      technical,
      fundamental,
      sentiment,
      etf,
      rebuttal,
      tailRisks: rebuttal.tailRisks ?? [],
      overall: {
        ...result.overall,
        score: enforcedScore,
        quantScore,
        quantFactors,
        calibration: calibrationContext ?? {
          scoreRange: 'N/A',
          historicalAccuracy: null,
          systematicBias: '样本不足',
          sampleSize: 0,
        },
      },
    };

    this.saveReport(report, horizon);

    return report;
  }

  private saveReport(report: SnpAnalysisReport, horizon: string): void {
    try {
      const db = getDb();
      const reportsRepo = new ReportsRepo(db);
      const reportId = reportsRepo.insert({
        date: report.timestamp.slice(0, 10),
        horizon,
        reportJson: JSON.stringify(report),
        overallScore: report.overall.score,
        direction: report.overall.direction,
      });

      const featuresRepo = new ScenarioFeaturesRepo(db);
      const d = report.marketData.dollarIndex?.value?.change ?? 0;
      featuresRepo.insert({
        date: report.timestamp.slice(0, 10),
        reportId,
        dollarDirection: d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat',
        dollarMagnitude: Math.abs(d),
        tipsDirection: 'flat',
        tipsMagnitude: 0,
        vixLevel: report.marketData.vix?.value?.value ?? 0,
        fedStance: 'neutral',
        momentumDirection: report.overall.direction === 'bullish' ? 'up' : report.overall.direction === 'bearish' ? 'down' : 'flat',
        consecutiveDays: 0,
      });
    } catch (err) {
      console.error('保存报告失败:', err);
    }
  }
}
