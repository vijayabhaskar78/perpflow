'use client';
import { calcFundingRate } from '../utils/math';

interface Props {
  markPrice: number | null;
  indexPrice: number | null;
  openInterestLong: number;
  openInterestShort: number;
}

export function MarketHeader({ markPrice, indexPrice, openInterestLong, openInterestShort }: Props) {
  const fundingRate = markPrice && indexPrice ? calcFundingRate(markPrice, indexPrice) : 0;
  const isPositiveFunding = fundingRate >= 0;

  return (
    <div className="flex items-center gap-8 p-4 bg-gray-900 border-b border-gray-800">
      <div>
        <div className="text-xs text-gray-400">Mark</div>
        <div className="text-lg font-mono font-bold">
          {markPrice ? `$${markPrice.toFixed(2)}` : '--'}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Index</div>
        <div className="text-lg font-mono">
          {indexPrice ? `$${indexPrice.toFixed(2)}` : '--'}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Funding/hr</div>
        <div className={`text-sm font-mono ${isPositiveFunding ? 'text-red-400' : 'text-green-400'}`}>
          {isPositiveFunding ? '+' : ''}{fundingRate.toFixed(4)}%
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Long OI</div>
        <div className="text-sm font-mono text-green-400">
          ${(openInterestLong / 1e15).toFixed(1)}K
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Short OI</div>
        <div className="text-sm font-mono text-red-400">
          ${(openInterestShort / 1e15).toFixed(1)}K
        </div>
      </div>
    </div>
  );
}
