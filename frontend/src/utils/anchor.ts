import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, RPC_URL, MARKET_INDEX } from './constants';

export function getProgram(wallet: anchor.Wallet) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require('../idl/perp_dex.json');
  return new anchor.Program(idl as anchor.Idl, provider);
}

export function getMarketPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
    PROGRAM_ID
  );
  return pda;
}

export function getUserAccountPda(userWallet: PublicKey): PublicKey {
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_account'), userWallet.toBuffer(), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getPositionPda(userWallet: PublicKey): PublicKey {
  const userAccountPda = getUserAccountPda(userWallet);
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), userAccountPda.toBuffer(), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getVaultPda(): PublicKey {
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function formatPrice(priceRaw: anchor.BN): string {
  const price = priceRaw.toNumber() / 1_000_000_000;
  return price.toFixed(2);
}

export function toMicroUsdc(usdcAmount: number): anchor.BN {
  return new anchor.BN(Math.floor(usdcAmount * 1_000_000));
}
