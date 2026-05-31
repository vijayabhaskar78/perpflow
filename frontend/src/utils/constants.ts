import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || '11111111111111111111111111111112'
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

export const MARKET_INDEX = Number(process.env.NEXT_PUBLIC_MARKET_INDEX || '0');

export const SOL_USD_ORACLE = new PublicKey(
  process.env.NEXT_PUBLIC_SOL_USD_ORACLE || 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'
);

export const SOL_USD_FEED_ID =
  process.env.NEXT_PUBLIC_SOL_USD_FEED_ID ||
  '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

export const HERMES_ENDPOINT = 'https://hermes-beta.pyth.network';

export const PRICE_PRECISION = 1_000_000_000;
export const AMM_RESERVE_PRECISION = 1_000_000_000;
export const RATIO_PRECISION = 1_000_000;
export const LAMPORTS_PER_USDC = 1_000_000;
export const TAKER_FEE_RATE = 1_000;
export const MAINTENANCE_MARGIN_RATIO = 62_500;
