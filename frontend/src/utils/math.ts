import { PRICE_PRECISION, RATIO_PRECISION, TAKER_FEE_RATE, MAINTENANCE_MARGIN_RATIO } from './constants';

export function formatUsd(micro: number): string {
  return (micro / 1_000_000).toFixed(2);
}

export function formatLargeUsd(micro: number): string {
  const usd = micro / 1_000_000;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

export function markPriceDisplay(quoteReserve: bigint, baseReserve: bigint): number {
  if (baseReserve === 0n) return 0;
  return Number((quoteReserve * BigInt(PRICE_PRECISION)) / baseReserve) / PRICE_PRECISION;
}

export function calcFundingRate(markPrice: number, indexPrice: number): number {
  if (indexPrice === 0) return 0;
  return ((markPrice - indexPrice) / indexPrice / 24) * 100;
}

export function calcLiquidationPrice(
  entryPrice: number,
  leverage: number,
  direction: 'long' | 'short'
): number {
  const maint = MAINTENANCE_MARGIN_RATIO / RATIO_PRECISION;
  if (direction === 'long') {
    return entryPrice * (1 - (1 / leverage - maint));
  }
  return entryPrice * (1 + (1 / leverage - maint));
}

export function calcFee(notional: number): number {
  return (notional * TAKER_FEE_RATE) / RATIO_PRECISION;
}

export function calcUnrealizedPnl(
  direction: 'long' | 'short',
  baseAmount: bigint,
  openNotional: number,
  baseReserve: bigint,
  quoteReserve: bigint,
  k: bigint
): number {
  if (baseAmount === 0n) return 0;
  let exitNotional: number;
  if (direction === 'long') {
    const newBase = baseReserve + baseAmount;
    const newQuote = k / newBase;
    exitNotional = Number(quoteReserve - newQuote) / 1_000_000;
  } else {
    const newQuote = quoteReserve + BigInt(openNotional);
    const newBase = k / newQuote;
    const baseReturned = baseReserve - newBase;
    exitNotional = Number(baseReturned) / 1e9;
  }
  if (direction === 'long') return exitNotional - openNotional / 1_000_000;
  return openNotional / 1_000_000 - exitNotional;
}
