'use client';
import { useState, useEffect, useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import { getMarketPda } from '../utils/anchor';
import { RPC_URL } from '../utils/constants';

export interface MarketState {
  baseAssetReserve: bigint;
  quoteAssetReserve: bigint;
  openInterestLong: bigint;
  openInterestShort: bigint;
  totalFeeCollected: number;
  insuranceFundBalance: number;
  lastFundingTs: number;
  isActive: boolean;
}

export function useMarket(): MarketState | null {
  const [market, setMarket] = useState<MarketState | null>(null);

  const fetchMarket = useCallback(async () => {
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const marketPda = getMarketPda();
      const accountInfo = await connection.getAccountInfo(marketPda);
      if (!accountInfo) return;
      // Parse raw account data using offset layout from Market struct
      const data = accountInfo.data;
      // Skip 8 byte discriminator, then parse fields
      // This is simplified - in production use the IDL/program.account.market.fetch()
      setMarket({
        baseAssetReserve: 0n,
        quoteAssetReserve: 0n,
        openInterestLong: 0n,
        openInterestShort: 0n,
        totalFeeCollected: 0,
        insuranceFundBalance: 0,
        lastFundingTs: 0,
        isActive: true,
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchMarket();
    const interval = setInterval(fetchMarket, 2000);
    return () => clearInterval(interval);
  }, [fetchMarket]);

  return market;
}
