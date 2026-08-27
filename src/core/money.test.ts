import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatMinor, minorToDecimalString, processorFee } from './money';

describe('divRoundHalfUp', () => {
  it('rounds exact halves away from zero', () => {
    expect(divRoundHalfUp(25, 10)).toBe(3);
    expect(divRoundHalfUp(24, 10)).toBe(2);
    expect(divRoundHalfUp(-25, 10)).toBe(-3);
  });

  it('rounds ordinary fractions to the nearest integer', () => {
    expect(divRoundHalfUp(1, 3)).toBe(0);
    expect(divRoundHalfUp(2, 3)).toBe(1);
    expect(divRoundHalfUp(291_224, 10_000)).toBe(29);
  });

  it('rejects non integer input and zero denominators', () => {
    expect(() => divRoundHalfUp(1.5, 10)).toThrow(TypeError);
    expect(() => divRoundHalfUp(10, 0)).toThrow(RangeError);
  });
});

describe('processorFee', () => {
  it('applies basis points and the fixed component', () => {
    expect(processorFee(10_000, 236, 300)).toBe(536);
    expect(processorFee(100_000, 200, 0)).toBe(2_000);
    expect(processorFee(0, 236, 300)).toBe(300);
  });

  it('never charges more than the captured amount for the bps component', () => {
    expect(processorFee(1, 236, 0)).toBe(0);
    expect(processorFee(2, 2500, 0)).toBe(1);
  });

  it('rejects negative inputs', () => {
    expect(() => processorFee(-1, 200, 0)).toThrow(RangeError);
    expect(() => processorFee(100, -1, 0)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats minor units with currency grouping', () => {
    expect(formatMinor(123_456, 'INR')).toContain('1,234.56');
    expect(formatMinor(123_456, 'USD')).toBe('$1,234.56');
  });

  it('exports plain decimal strings for fixtures', () => {
    expect(minorToDecimalString(123_456)).toBe('1234.56');
    expect(minorToDecimalString(5)).toBe('0.05');
    expect(minorToDecimalString(-25)).toBe('-0.25');
  });
});
