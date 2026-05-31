'use client';
import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { getUserAccountPda } from '../utils/anchor';

export interface UserAccountState {
  collateral: number;
  totalDeposited: number;
  totalWithdrawn: number;
}

export function useUserAccount(program: anchor.Program | null): UserAccountState | null {
  const { publicKey } = useWallet();
  const [account, setAccount] = useState<UserAccountState | null>(null);

  const fetchAccount = useCallback(async () => {
    if (!publicKey || !program) return;
    try {
      const pda = getUserAccountPda(publicKey);
      const data = await (program.account as any).userAccount.fetch(pda);
      setAccount({
        collateral: data.collateral.toNumber(),
        totalDeposited: data.totalDeposited.toNumber(),
        totalWithdrawn: data.totalWithdrawn.toNumber(),
      });
    } catch {
      setAccount(null);
    }
  }, [publicKey, program]);

  useEffect(() => {
    fetchAccount();
    const interval = setInterval(fetchAccount, 3000);
    return () => clearInterval(interval);
  }, [fetchAccount]);

  return account;
}
