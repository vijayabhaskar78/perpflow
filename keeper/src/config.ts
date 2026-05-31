import * as anchor from '@coral-xyz/anchor';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config();

export const CLUSTER_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
export const PROGRAM_ID = new anchor.web3.PublicKey(
  process.env.PROGRAM_ID || '11111111111111111111111111111112'
);
const keeperKeypairJson =
  process.env.KEEPER_KEYPAIR && process.env.KEEPER_KEYPAIR !== '[]'
    ? process.env.KEEPER_KEYPAIR
    : fs.readFileSync(
        path.resolve(__dirname, '..', process.env.KEYPAIR_PATH || '../deployer-keypair.json'),
        'utf-8'
      );

export const KEEPER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
  Buffer.from(JSON.parse(keeperKeypairJson))
);

export const MAINTENANCE_MARGIN_RATIO = 62_500;

export const MARKETS = [
  {
    index: 0,
    name: 'SOL-USD',
    oracle: new anchor.web3.PublicKey(
      process.env.SOL_USD_ORACLE || 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'
    ),
  },
];

export const LIQUIDATION_POLL_MS = Number(process.env.LIQUIDATION_POLL_MS || 10_000);
export const FUNDING_SETTLE_INTERVAL_MS = 300_000;
export const AMM_UPDATE_INTERVAL_MS = 900_000;
export const STALE_FUNDING_THRESHOLD_SECS = 300;
