'use client';
import { useState } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';

interface Props {
  program: anchor.Program | null;
  usdcMint: PublicKey | null;
}

export function FaucetButton({ program, usdcMint }: Props) {
  const { publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);

  const handleMint = async () => {
    if (!program || !publicKey || !usdcMint) return;
    setLoading(true);
    try {
      const userTokenAccount = await getAssociatedTokenAddress(usdcMint, publicKey);
      const [mintAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority')],
        program.programId
      );
      const [usdcMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('usdc_mint')],
        program.programId
      );

      await (program.methods as any)
        .mintTestUsdc()
        .accounts({
          user: publicKey,
          usdcMint: usdcMintPda,
          userTokenAccount,
          mintAuthority,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (e: any) {
      console.error('Faucet error:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleMint}
      disabled={loading || !program || !publicKey}
      className="text-xs px-3 py-1.5 bg-purple-800 hover:bg-purple-700 rounded disabled:opacity-50"
    >
      {loading ? 'Minting...' : 'Get 10,000 test USDC'}
    </button>
  );
}
