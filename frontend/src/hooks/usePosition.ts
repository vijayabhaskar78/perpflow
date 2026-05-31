'use client';
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { getPositionPda } from '../utils/anchor';

export interface PositionState {
  isOpen: boolean;
  direction: 'long' | 'short';
  baseAssetAmount: bigint;
  openNotional: number;
  entryPrice: number;
  collateral: number;
  leverage: number;
  lastFundingTs: number;
}

export function usePosition(program: anchor.Program | null): PositionState | null {
  const { publicKey } = useWallet();
  const [position, setPosition] = useState<PositionState | null>(null);

  const fetchPosition = useCallback(async () => {
    if (!publicKey || !program) return;
    try {
      const pda = getPositionPda(publicKey);
      const data = await (program.account as any).position.fetch(pda);
      if (!data.isOpen) { setPosition(null); return; }
      setPosition({
        isOpen: data.isOpen,
        direction: data.direction.long !== undefined ? 'long' : 'short',
        baseAssetAmount: BigInt(data.baseAssetAmount.toString()),
        openNotional: data.openNotional.toNumber(),
        entryPrice: Number(data.entryPrice.toString()) / 1e9,
        collateral: data.collateral.toNumber(),
        leverage: data.leverage,
        lastFundingTs: data.lastFundingTs.toNumber(),
      });
    } catch {
      setPosition(null);
    }
  }, [publicKey, program]);

  useEffect(() => {
    fetchPosition();
    const interval = setInterval(fetchPosition, 3000);
    return () => clearInterval(interval);
  }, [fetchPosition]);

  return position;
}
