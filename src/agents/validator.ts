// 信息验证 Agent — 多源交叉验证 + 来源分级

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { gradeSource, crossValidate, checkFreshness } from '../utils/source-rank.js';
import type { MarketData, ValidationResult } from '../types/market.js';

export class ValidatorAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({
      name: 'validator',
      model: config.models.validator,
      systemPrompt: '',
    });
  }

  async validate(data: MarketData): Promise<{
    validations: ValidationResult[];
    overallConfidence: number;
    warnings: string[];
  }> {
    const validations: ValidationResult[] = [];

    // 验证 SPX
    if (data.spx?.price?.value != null) {
      validations.push(crossValidate('spx.price', [{
        value: data.spx.price.value,
        source: data.spx.price.source ?? 'unknown',
        grade: data.spx.price.sourceGrade ?? 'C',
        timestamp: data.spx.price.verifiedAt ?? '',
      }]));
    }

    // 验证 IXIC
    if (data.ixic?.price?.value != null) {
      validations.push(crossValidate('ixic.price', [{
        value: data.ixic.price.value,
        source: data.ixic.price.source ?? 'unknown',
        grade: data.ixic.price.sourceGrade ?? 'C',
        timestamp: data.ixic.price.verifiedAt ?? '',
      }]));
    }

    // 验证 SPY
    if (data.spy?.nav?.value != null) {
      validations.push(crossValidate('spy.nav', [{
        value: data.spy.nav.value,
        source: data.spy.nav.source ?? 'unknown',
        grade: data.spy.nav.sourceGrade ?? 'C',
        timestamp: data.spy.nav.verifiedAt ?? '',
      }]));
    }

    // 验证 QQQ
    if (data.qqq?.nav?.value != null) {
      validations.push(crossValidate('qqq.nav', [{
        value: data.qqq.nav.value,
        source: data.qqq.nav.source ?? 'unknown',
        grade: data.qqq.nav.sourceGrade ?? 'C',
        timestamp: data.qqq.nav.verifiedAt ?? '',
      }]));
    }

    // 验证 VIX
    if (data.vix?.value?.value != null) {
      validations.push(crossValidate('vix.value', [{
        value: data.vix.value.value,
        source: data.vix.value.source ?? 'unknown',
        grade: data.vix.value.sourceGrade ?? 'C',
        timestamp: data.vix.value.verifiedAt ?? '',
      }]));
    }

    // 验证美元指数
    if (data.dollarIndex?.value?.value != null) {
      validations.push(crossValidate('dollarIndex.value', [{
        value: data.dollarIndex.value.value,
        source: data.dollarIndex.value.source ?? 'unknown',
        grade: data.dollarIndex.value.sourceGrade ?? 'C',
        timestamp: data.dollarIndex.value.verifiedAt ?? '',
      }]));
    }

    const warnings: string[] = [];
    const freshness = checkFreshness(data.timestamp);
    if (!freshness.fresh && freshness.warning) {
      warnings.push(freshness.warning);
    }

    const overallConfidence = validations.length > 0
      ? Math.round(validations.reduce((sum, v) => sum + v.confidence, 0) / validations.length)
      : 50;

    return { validations, overallConfidence, warnings };
  }
}
