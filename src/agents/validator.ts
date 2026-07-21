// 信息验证 Agent — 多源交叉验证 + 加权置信度 + 跳过缺失价

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import {
  crossValidate,
  checkFreshness,
  validationSourcesFromPrices,
  weightedFieldConfidence,
} from '../utils/source-rank.js';
import { isMissingPrice } from '../schemas/market.js';
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

    const pushField = (field: string, primary: Parameters<typeof validationSourcesFromPrices>[0]) => {
      if (isMissingPrice(primary)) return;
      const sources = validationSourcesFromPrices(primary);
      if (sources.length === 0) return;
      validations.push(crossValidate(field, sources));
    };

    pushField('spx.price', data.spx?.price);
    pushField('ixic.price', data.ixic?.price);
    pushField('spy.nav', data.spy?.nav);
    pushField('qqq.nav', data.qqq?.nav);
    pushField('vix.value', data.vix?.value);
    pushField('dollarIndex.value', data.dollarIndex?.value);
    pushField('usTreasury.yield10y', data.usTreasury?.yield10y);

    const warnings: string[] = [];
    const freshness = checkFreshness(data.timestamp);
    if (!freshness.fresh && freshness.warning) {
      warnings.push(freshness.warning);
    }

    if (validations.some(v => v.consensus === 'single_source')) {
      warnings.push('部分字段仅单源交叉');
    }

    const overallConfidence = weightedFieldConfidence(validations);

    return { validations, overallConfidence, warnings };
  }
}
