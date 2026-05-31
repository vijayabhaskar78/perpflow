'use client';
import { useState } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { getMarketPda, getUserAccountPda, getPositionPda } from '../utils/anchor';
import { PositionState } from '../hooks/usePosition';
import { SOL_USD_ORACLE } from '../utils/constants';
import { MAINTENANCE_MARGIN_RATIO, RATIO_PRECISION } from '../utils/constants';

interface Props {
  program: anchor.Program | null;
  position: PositionState | null;
  markPrice: number | null;
  onSuccess: () => void;
}

export function PositionPanel({ program, position, markPrice, onSuccess }: Props) {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);

  if (!position || !position.isOpen) {
    return (
      <div className="p-4 bg-gray-900 rounded-lg text-center text-gray-500 text-sm">
        No open position
      </div>
    );
  }

  const unrealizedPnl = markPrice
    ? position.direction === 'long'
      ? (markPrice - position.entryPrice) * (Number(position.baseAssetAmount) / 1e9)
      : (position.entryPrice - markPrice) * (Number(position.baseAssetAmount) / 1e9)
    : 0;

  const pnlPct = position.openNotional > 0
    ? (unrealizedPnl / (position.openNotional / 1e6)) * 100
    : 0;

  const health = position.openNotional > 0
    ? ((position.collateral / 1e6 + unrealizedPnl) / (position.openNotional / 1e6)) * 100
    : 0;

  const healthColor = health > 20 ? 'text-green-400' : health > 10 ? 'text-yellow-400' : 'text-red-400';

  const handleClose = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      const marketPda = getMarketPda();
      const userAccountPda = getUserAccountPda(publicKey);
      const positionPda = getPositionPda(publicKey);

      await (program.methods as any)
        .closePosition()
        .accounts({
          user: publicKey,
          userAccount: userAccountPda,
          position: positionPda,
          market: marketPda,
          oracle: SOL_USD_ORACLE,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      onSuccess();
    } catch (e: any) {
      console.error('Close failed:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-900 rounded-lg space-y-3">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${position.direction === 'long' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
          {position.direction.toUpperCase()}
        </span>
        <span className="text-sm text-gray-400">{position.leverage}x leverage</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-400">Entry Price</span>
          <div className="font-mono">${position.entryPrice.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-gray-400">Mark Price</span>
          <div className="font-mono">{markPrice ? `$${markPrice.toFixed(2)}` : '--'}</div>
        </div>
        <div>
          <span className="text-gray-400">Collateral</span>
          <div className="font-mono">${(position.collateral / 1e6).toFixed(2)}</div>
        </div>
        <div>
          <span className="text-gray-400">Health</span>
          <div className={`font-mono ${healthColor}`}>{health.toFixed(1)}%</div>
        </div>
      </div>

      <div className="border-t border-gray-800 pt-2">
        <span className="text-gray-400 text-xs">Unrealized PnL</span>
        <div className={`text-lg font-mono font-bold ${unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
          <span className="text-sm ml-1">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
        </div>
      </div>

      <button
        onClick={handleClose}
        disabled={loading}
        className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium disabled:opacity-50"
      >
        {loading ? 'Closing...' : 'Close Position'}
      </button>
    </div>
  );
}
