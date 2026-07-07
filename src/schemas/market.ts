// MarketData Zod 校验与规范化 — LLM 输出后兜底

import { z } from 'zod';
import { gradeSource } from '../utils/source-rank.js';
import type { MarketData, SourceGrade, SourcedPrice, SourcedValue } from '../types/market.js';

const sourceGradeSchema = z.enum(['A', 'B', 'C']).catch('B' as SourceGrade);

const sourcedPriceInner = z.object({
  value: z.number().finite().nullable().optional(),
  change: z.number().finite().optional().default(0),
  source: z.string().optional().default('unknown'),
  sourceGrade: sourceGradeSchema.optional(),
  verifiedAt: z.string().optional().default(''),
});

const sourcedValueSchema = z.object({
  value: z.number().finite().nullable().optional(),
  source: z.string().optional().default('unknown'),
  sourceGrade: sourceGradeSchema.optional(),
  verifiedAt: z.string().optional().default(''),
});

const sourcedPriceSchema = z.union([
  z.number().finite(),
  sourcedPriceInner,
  z.null(),
]).transform((p): SourcedPrice | null => {
  if (p == null) return null;
  if (typeof p === 'number') {
    return {
      value: p,
      change: 0,
      source: 'unknown',
      sourceGrade: 'B' as SourceGrade,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (p.value == null || !Number.isFinite(p.value)) return null;
  const source = p.source || 'unknown';
  return {
    value: p.value,
    change: p.change ?? 0,
    source,
    sourceGrade: (p.sourceGrade ?? gradeSource(source)) as SourceGrade,
    verifiedAt: p.verifiedAt || new Date().toISOString(),
  };
});

const indexDataSchema = z.object({
  price: sourcedPriceSchema,
  high: sourcedValueSchema.nullable().optional().catch(null),
  low: sourcedValueSchema.nullable().optional().catch(null),
  pe: sourcedValueSchema.nullable().optional().catch(null),
  dividend: sourcedValueSchema.nullable().optional().catch(null),
}).passthrough().optional().catch(undefined);

const etfDataSchema = z.object({
  code: z.string().optional().default('SPY'),
  name: z.string().optional().default('SPDR S&P 500 ETF'),
  nav: sourcedPriceSchema,
  premiumDiscount: sourcedValueSchema.nullable().optional().catch(null),
  ytdReturn: sourcedValueSchema.nullable().optional().catch(null),
}).passthrough().optional().catch(undefined);

const marketDataSchema = z.object({
  timestamp: z.string().min(1).catch(() => new Date().toISOString()),
  spx: indexDataSchema,
  ixic: indexDataSchema,
  spy: etfDataSchema,
  qqq: z.object({
    code: z.string().optional().default('QQQ'),
    name: z.string().optional().default('Invesco QQQ Trust'),
    nav: sourcedPriceSchema,
    premiumDiscount: sourcedValueSchema.nullable().optional().catch(null),
    ytdReturn: sourcedValueSchema.nullable().optional().catch(null),
  }).passthrough().optional().catch(undefined),
  voo: z.object({
    code: z.string().optional().default('VOO'),
    name: z.string().optional().default('Vanguard S&P 500 ETF'),
    nav: sourcedPriceSchema,
    premiumDiscount: sourcedValueSchema.nullable().optional().catch(null),
    ytdReturn: sourcedValueSchema.nullable().optional().catch(null),
  }).passthrough().optional().catch(undefined),
  vix: z.object({
    value: sourcedPriceSchema,
  }).passthrough().optional().catch(undefined),
  dollarIndex: z.object({
    value: sourcedPriceSchema,
  }).passthrough().optional().catch(undefined),
  usTreasury: z.object({
    yield10y: sourcedPriceSchema,
    yield2y: sourcedPriceSchema,
    tips10y: sourcedValueSchema.nullable().optional().catch(null),
  }).passthrough().optional().catch(undefined),
}).passthrough();

function nullPrice(): SourcedPrice {
  return {
    value: 0,
    change: 0,
    source: 'N/A',
    sourceGrade: 'C',
    verifiedAt: new Date().toISOString(),
  };
}

function nullValue(): SourcedValue<number> {
  return {
    value: 0,
    source: 'N/A',
    sourceGrade: 'C',
    verifiedAt: new Date().toISOString(),
  };
}

/** 规范化 LLM 输出的 MarketData，过滤无效字段 */
export function parseMarketData(input: unknown): MarketData {
  const parsed = marketDataSchema.parse(input);

  const spxPrice = parsed.spx?.price ?? nullPrice();
  const ixicPrice = parsed.ixic?.price ?? nullPrice();
  const dxy = parsed.dollarIndex?.value ?? nullPrice();
  const y10 = parsed.usTreasury?.yield10y ?? nullPrice();
  const y2 = parsed.usTreasury?.yield2y ?? nullPrice();

  return {
    timestamp: parsed.timestamp,
    spx: {
      ...(parsed.spx ?? {}),
      price: spxPrice,
      high: parsed.spx?.high ?? undefined,
      low: parsed.spx?.low ?? undefined,
      pe: parsed.spx?.pe ?? undefined,
      dividend: parsed.spx?.dividend ?? undefined,
    },
    ixic: {
      ...(parsed.ixic ?? {}),
      price: ixicPrice,
      high: parsed.ixic?.high ?? undefined,
      low: parsed.ixic?.low ?? undefined,
    },
    spy: {
      code: parsed.spy?.code ?? 'SPY',
      name: parsed.spy?.name ?? 'SPDR S&P 500 ETF',
      nav: parsed.spy?.nav ?? nullPrice(),
      premiumDiscount: parsed.spy?.premiumDiscount ?? undefined,
      ytdReturn: parsed.spy?.ytdReturn ?? undefined,
    },
    qqq: {
      code: parsed.qqq?.code ?? 'QQQ',
      name: parsed.qqq?.name ?? 'Invesco QQQ Trust',
      nav: parsed.qqq?.nav ?? nullPrice(),
      premiumDiscount: parsed.qqq?.premiumDiscount ?? undefined,
      ytdReturn: parsed.qqq?.ytdReturn ?? undefined,
    },
    voo: parsed.voo ? {
      code: parsed.voo.code ?? 'VOO',
      name: parsed.voo.name ?? 'Vanguard S&P 500 ETF',
      nav: parsed.voo.nav ?? nullPrice(),
      premiumDiscount: parsed.voo.premiumDiscount ?? undefined,
      ytdReturn: parsed.voo.ytdReturn ?? undefined,
    } : undefined,
    vix: { value: parsed.vix?.value ?? nullPrice() },
    dollarIndex: { value: dxy },
    usTreasury: {
      yield10y: y10,
      yield2y: y2,
      tips10y: parsed.usTreasury?.tips10y ?? undefined,
    },
  } as MarketData;
}
