import type { Currency } from './types';

export const BPS_DENOMINATOR = 10_000;

const MINOR_DIGITS: Record<Currency, number> = { INR: 2, USD: 2, EUR: 2 };

/**
 * Divide two integers and round half away from zero, without ever producing a float
 * intermediate large enough to lose precision. `denominator` must be positive.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new TypeError('divRoundHalfUp expects integer operands');
  }
  if (denominator <= 0) {
    throw new RangeError('divRoundHalfUp expects a positive denominator');
  }
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.abs(numerator);
  return sign * Math.floor((magnitude * 2 + denominator) / (2 * denominator));
}

/** Fee for a charge: basis points of gross, rounded half up, plus the fixed component. */
export function processorFee(gross: number, feeBps: number, feeFixed: number): number {
  if (gross < 0) throw new RangeError('processorFee expects a non-negative gross amount');
  if (feeBps < 0 || feeFixed < 0) throw new RangeError('fee plan cannot be negative');
  return divRoundHalfUp(gross * feeBps, BPS_DENOMINATOR) + feeFixed;
}

/** Net an account would receive after fees. Never returns a negative number. */
export function netOfFee(gross: number, fee: number): number {
  return Math.max(0, gross - fee);
}

export function toMinor(major: number, currency: Currency = 'INR'): number {
  return Math.round(major * 10 ** MINOR_DIGITS[currency]);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format minor units for display. Uses the en-IN grouping for INR, en-US otherwise. */
export function formatMinor(amount: number, currency: Currency, options: { compact?: boolean } = {}): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const key = `${currency}:${locale}:${options.compact ? 'compact' : 'full'}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: options.compact ? 0 : MINOR_DIGITS[currency],
      maximumFractionDigits: options.compact ? 1 : MINOR_DIGITS[currency],
      notation: options.compact ? 'compact' : 'standard',
    });
    formatters.set(key, formatter);
  }
  return formatter.format(amount / 100);
}

/** Plain decimal string for CSV exports and regression fixtures, e.g. 1234 -> "12.34". */
export function minorToDecimalString(amount: number, currency: Currency = 'INR'): string {
  const digits = MINOR_DIGITS[currency];
  const sign = amount < 0 ? '-' : '';
  const magnitude = Math.abs(amount);
  const unit = 10 ** digits;
  return `${sign}${Math.floor(magnitude / unit)}.${String(magnitude % unit).padStart(digits, '0')}`;
}
