import { describe, it, expect } from 'vitest';
import { scoreBucketRange } from '../src/utils/score-buckets';

describe('scoreBucketRange — 满分 100 归入最高区间', () => {
  it('满分 100 应归入 90-100（修复满分无校准上下文）', () => {
    expect(scoreBucketRange(100)?.range).toBe('90-100');
  });

  it('90 归入 90-100', () => {
    expect(scoreBucketRange(90)?.range).toBe('90-100');
  });

  it('89.9 归入 80-90', () => {
    expect(scoreBucketRange(89.9)?.range).toBe('80-90');
  });

  it('0 归入 0-30', () => {
    expect(scoreBucketRange(0)?.range).toBe('0-30');
  });

  it('越界分值返回 null', () => {
    expect(scoreBucketRange(-1)).toBeNull();
    expect(scoreBucketRange(101)).toBeNull();
  });
});
