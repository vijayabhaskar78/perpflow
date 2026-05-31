'use client';
import { useState } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey, Connection } from '@solana/web3.js';
import { getMarketPda, getUserAccountPda, getVaultPda } from '../utils/anchor';
import { RPC_URL, MARKET_INDEX } from '../utils/constants';

interface Props {
  program: anchor.Program | null;
  collateralBalance: number;
  quoteMint: PublicKey | null;
  onSuccess: () => void;
  onClose: () => void;
}

export function CollateralModal({ program, collateralBalance, quoteMint, onSuccess, onClose }: Props) {
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!program || !publicKey || !quoteMint) return;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setError('Invalid amount'); return; }

    setLoading(true);
    setError('');
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const marketPda = getMarketPda();
      const userAccountPda = getUserAccountPda(publicKey);
      const vaultPda = getVaultPda();
      const userTokenAccount = await getAssociatedTokenAddress(quoteMint, publicKey);
      const amountBn = new anchor.BN(Math.floor(amountNum * 1_000_000));

      if (tab === 'deposit') {
        await (program.methods as any)
          .depositCollateral(MARKET_INDEX, amountBn)
          .accounts({
            user: publicKey,
            userAccount: userAccountPda,
            market: marketPda,
            vault: vaultPda,
            userTokenAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();
      } else {
        await (program.methods as any)
          .withdrawCollateral(MARKET_INDEX, amountBn)
          .accounts({
            user: publicKey,
            userAccount: userAccountPda,
            market: marketPda,
            vault: vaultPda,
            userTokenAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .rpc();
      }
      onSuccess();
      setAmount('');
    } catch (e: any) {
      setError(e?.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-sm border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold">Collateral</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <div className="flex gap-2 mb-4">
          {(['deposit', 'withdraw'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded text-sm ${tab === t ? 'bg-blue-700' : 'bg-gray-800 text-gray-400'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="text-xs text-gray-400 mb-1">
          Available: ${(collateralBalance / 1e6).toFixed(2)} USDC
        </div>

        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full bg-gray-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 mb-3"
          placeholder="0.00"
        />

        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Processing...' : tab === 'deposit' ? 'Deposit' : 'Withdraw'}
        </button>
      </div>
    </div>
  );
}
