// MarketData Zod 校验与规范化 — LLM 输出后兜底（美股 SPX/IXIC/ETF）

import { z } from 'zod';
import { gradeSource } from '../utils/source-rank.js';
import type {
  MarketData,
  SourceGrade,
  SourcedPrice,
  SourcedValue,
  IndexData,
  EtfData,
} from '../types/market.js';

const sourceGradeSchema = z.enum(['A', 'B', 'C']).catch('B' as SourceGrade);

const sourcedPriceInner = z.object({
  value: z.number().finite().nullable().optional(),
  change: z.number().finite().optional().default(0),
  source: z.string().optional().default('unknown'),
  sourceGrade: sourceGradeSchema.optional(),
  verifiedAt: z.string().optional().default(''),
});

/**
 * 市场数值是否可采信。
 * 拒绝 NaN/Inf；拒绝 0（LLM/占位常把缺失写成 0，指数/ETF/VIX 实际不会为 0）。
 * 允许负数（如 TIPS 实际利率可为负）。
 */
export function isValidMarketNumber(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  if (value === 0) return false;
  return true;
}

const sourcedPriceSchema = z.union([
  z.number().finite(),
  sourcedPriceInner,
  z.null(),
]).transform((p): SourcedPrice | null => {
  if (p == null) return null;
  if (typeof p === 'number') {
    if (!isValidMarketNumber(p)) return null;
    return {
      value: p,
      change: 0,
      source: 'unknown',
      sourceGrade: 'B' as SourceGrade,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (p.value == null || !Number.isFinite(p.value) || !isValidMarketNumber(p.value)) return null;
  const source = p.source || 'unknown';
  return {
    value: p.value,
    change: p.change ?? 0,
    source,
    sourceGrade: (p.sourceGrade ?? gradeSource(source)) as SourceGrade,
    verifiedAt: p.verifiedAt || new Date().toISOString(),
  };
});

const sourcedValueInner = z.object({
  value: z.number().finite().nullable().optional(),
  source: z.string().optional().default('unknown'),
  sourceGrade: sourceGradeSchema.optional(),
  verifiedAt: z.string().optional().default(''),
});

const sourcedValueSchema = z.union([
  z.number().finite(),
  sourcedValueInner,
  z.null(),
]).transform((p): SourcedValue<number> | null => {
  if (p == null) return null;
  if (typeof p === 'number') {
    if (!isValidMarketNumber(p)) return null;
    return {
      value: p,
      source: 'unknown',
      sourceGrade: 'B' as SourceGrade,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (p.value == null || !Number.isFinite(p.value) || !isValidMarketNumber(p.value)) return null;
  const source = p.source || 'unknown';
  return {
    value: p.value,
    source,
    sourceGrade: (p.sourceGrade ?? gradeSource(source)) as SourceGrade,
    verifiedAt: p.verifiedAt || new Date().toISOString(),
  };
});

/** TIPS 允许负值，仅拒绝 null/NaN/恰好为 0 的占位 */
const tipsValueSchema = z.union([
  z.number().finite(),
  sourcedValueInner,
  z.null(),
]).transform((p): SourcedValue<number> | null => {
  if (p == null) return null;
  if (typeof p === 'number') {
    if (!Number.isFinite(p) || p === 0) return null;
    return {
      value: p,
      source: 'unknown',
      sourceGrade: 'B' as SourceGrade,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (p.value == null || !Number.isFinite(p.value) || p.value === 0) return null;
  const source = p.source || 'unknown';
  return {
    value: p.value,
    source,
    sourceGrade: (p.sourceGrade ?? gradeSource(source)) as SourceGrade,
    verifiedAt: p.verifiedAt || new Date().toISOString(),
  };
});

const indexDataSchema = z.object({
  price: sourcedPriceSchema,
  high: z.unknown().optional(),
  low: z.unknown().optional(),
  pe: sourcedValueSchema.optional().nullable(),
  dividend: sourcedValueSchema.optional().nullable(),
}).passthrough().optional().catch(undefined);

const etfDataSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  nav: sourcedPriceSchema,
  premiumDiscount: z.unknown().optional(),
  ytdReturn: z.unknown().optional(),
}).passthrough().optional().catch(undefined);

const marketDataSchema = z.object({
  timestamp: z.string().min(1).catch(() => new Date().toISOString()),
  spx: indexDataSchema,
  ixic: indexDataSchema,
  spy: etfDataSchema,
  qqq: etfDataSchema,
  voo: etfDataSchema,
  vix: z.object({
    value: sourcedPriceSchema,
  }).passthrough().optional().catch(undefined),
  dollarIndex: z.object({
    value: sourcedPriceSchema,
  }).passthrough().optional().catch(undefined),
  usTreasury: z.object({
    yield10y: sourcedPriceSchema,
    yield2y: sourcedPriceSchema.optional().nullable(),
    tips10y: tipsValueSchema.optional().nullable(),
  }).passthrough().optional().catch(undefined),
}).passthrough();

/** 占位价：source=N/A + value=0，入库/指标侧必须用 isMissingPrice 过滤 */
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

/** 是否为缺失/不可用报价（N/A 或非法数值） */
export function isMissingPrice(p: SourcedPrice | SourcedValue<number> | null | undefined): boolean {
  if (p == null) return true;
  if (p.source === 'N/A') return true;
  return !isValidMarketNumber(p.value);
}

function buildIndex(
  parsed: { price?: SourcedPrice | null; pe?: SourcedValue<number> | null } | undefined,
  fallback: IndexData,
): IndexData {
  const price = parsed?.price ?? nullPrice();
  return {
    ...fallback,
    ...(parsed ?? {}),
    price: price ?? nullPrice(),
    pe: parsed?.pe ?? undefined,
  };
}

function buildEtf(
  parsed: { code?: string; name?: string; nav?: SourcedPrice | null } | undefined,
  defaults: { code: string; name: string },
): EtfData {
  return {
    code: parsed?.code ?? defaults.code,
    name: parsed?.name ?? defaults.name,
    nav: parsed?.nav ?? nullPrice(),
  };
}

/** 规范化 LLM 输出的 MarketData，零值不写进有效字段 */
export function parseMarketData(input: unknown): MarketData {
  const parsed = marketDataSchema.parse(input);

  const tips = parsed.usTreasury?.tips10y ?? null;
  const tipsOk = tips != null && Number.isFinite(tips.value) && tips.value !== 0;

  return {
    timestamp: parsed.timestamp,
    spx: buildIndex(parsed.spx as { price?: SourcedPrice | null; pe?: SourcedValue<number> | null } | undefined, {
      price: nullPrice(),
    }),
    ixic: buildIndex(parsed.ixic as { price?: SourcedPrice | null; pe?: SourcedValue<number> | null } | undefined, {
      price: nullPrice(),
    }),
    spy: buildEtf(parsed.spy as { code?: string; name?: string; nav?: SourcedPrice | null } | undefined, {
      code: 'SPY',
      name: 'SPDR S&P 500 ETF',
    }),
    qqq: buildEtf(parsed.qqq as { code?: string; name?: string; nav?: SourcedPrice | null } | undefined, {
      code: 'QQQ',
      name: 'Invesco QQQ Trust',
    }),
    voo: parsed.voo
      ? buildEtf(parsed.voo as { code?: string; name?: string; nav?: SourcedPrice | null }, {
          code: 'VOO',
          name: 'Vanguard S&P 500 ETF',
        })
      : undefined,
    vix: { value: parsed.vix?.value ?? nullPrice() },
    dollarIndex: { value: parsed.dollarIndex?.value ?? nullPrice() },
    usTreasury: {
      yield10y: parsed.usTreasury?.yield10y ?? nullPrice(),
      yield2y: parsed.usTreasury?.yield2y ?? nullPrice(),
      tips10y: tipsOk
        ? tips!
        : nullValue(),
    },
  };
}
