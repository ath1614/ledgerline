import { formatMinor } from '../core/money';
import type { Currency } from '../core/types';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Kolkata',
});

const dayFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

export function money(amount: number, currency: Currency = 'INR'): string {
  return formatMinor(amount, currency);
}

export function moneyCompact(amount: number, currency: Currency = 'INR'): string {
  return formatMinor(amount, currency, { compact: true });
}

export function when(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

export function day(timestamp: number): string {
  return dayFormatter.format(new Date(timestamp));
}

export function relativeDays(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function riskLabel(score: number): 'clear' | 'watch' | 'review' | 'block' {
  if (score >= 85) return 'block';
  if (score >= 60) return 'review';
  if (score > 0) return 'watch';
  return 'clear';
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
