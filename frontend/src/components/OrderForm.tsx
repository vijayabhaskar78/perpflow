'use client';
import { useState } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { getMarketPda, getUserAccountPda, getPositionPda } from '../utils/anchor';
import { calcLiquidationPrice, calcFee } from '../utils/math';
import { SOL_USD_ORACLE } from '../utils/constants';

interface Props {
  program: anchor.Program | null;
  markPrice: number | null;
  collateralBalance: number;
  onSuccess: () => void;
}

export function OrderForm({ program, markPrice, collateralBalance, onSuccess }: Props) {
  const { publicKey } = useWallet();
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const collateralNum = parseFloat(collateral) || 0;
  const notional = collateralNum * leverage;
  const fee = calcFee(notional * 1e6) / 1e6;
  const liqPrice = markPrice
    ? calcLiquidationPrice(markPrice, leverage, direction)
    : null;

  const handleOpen = async () => {
    if (!program || !publicKey || !markPrice) return;
    if (collateralNum <= 0) { setError('Enter collateral amount'); return; }
    setLoading(true);
    setError('');
    try {
      const marketPda = getMarketPda();
      const userAccountPda = getUserAccountPda(publicKey);
      const positionPda = getPositionPda(publicKey);

      const directionArg = direction === 'long' ? { long: {} } : { short: {} };
      const collateralBn = new anchor.BN(Math.floor(collateralNum * 1_000_000));

      await (program.methods as any)
        .openPosition({ direction: directionArg, collateral: collateralBn, leverage })
        .accounts({
          user: publicKey,
          userAccount: userAccountPda,
          position: positionPda,
          market: marketPda,
          oracle: SOL_USD_ORACLE,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-gray-900 rounded-lg">
      <div className="flex gap-2">
        <button
          onClick={() => setDirection('long')}
          className={`flex-1 py-2 rounded font-bold text-sm ${direction === 'long' ? 'bg-green-600' : 'bg-gray-800 text-gray-400'}`}
        >
          LONG
        </button>
        <button
          onClick={() => setDirection('short')}
          className={`flex-1 py-2 rounded font-bold text-sm ${direction === 'short' ? 'bg-red-600' : 'bg-gray-800 text-gray-400'}`}
        >
          SHORT
        </button>
      </div>

      <div>
        <label className="text-xs text-gray-400">Collateral (USDC)</label>
        <div className="flex gap-2 mt-1">
          <input
            type="number"
            value={collateral}
            onChange={e => setCollateral(e.target.value)}
            className="flex-1 bg-gray-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="0.00"
            min="0"
          />
          <button
            onClick={() => setCollateral(String((collateralBalance / 1e6).toFixed(2)))}
            className="text-xs text-blue-400 px-2"
          >
            MAX
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400">Leverage: {leverage}x</label>
        <input
          type="range"
          min={1}
          max={10}
          value={leverage}
          onChange={e => setLeverage(Number(e.target.value))}
          className="w-full mt-1"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>1x</span><span>5x</span><span>10x</span>
        </div>
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <div className="flex justify-between">
          <span>Notional</span>
          <span className="font-mono">${notional.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Liq. Price</span>
          <span className="font-mono text-yellow-400">{liqPrice ? `$${liqPrice.toFixed(2)}` : '--'}</span>
        </div>
        <div className="flex justify-between">
          <span>Fee (0.1%)</span>
          <span className="font-mono">${fee.toFixed(4)}</span>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button
        onClick={handleOpen}
        disabled={loading || !program || !publicKey}
        className={`w-full py-3 rounded font-bold text-sm transition ${
          direction === 'long'
            ? 'bg-green-600 hover:bg-green-500 disabled:bg-green-900'
            : 'bg-red-600 hover:bg-red-500 disabled:bg-red-900'
        } disabled:cursor-not-allowed`}
      >
        {loading ? 'Opening...' : `Open ${direction.toUpperCase()}`}
      </button>
    </div>
  );
}
