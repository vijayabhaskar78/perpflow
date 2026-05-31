import { Connection, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { CLUSTER_URL, PROGRAM_ID, KEEPER_KEYPAIR } from './config';
import { runLiquidator } from './liquidator';
import { runFundingSettler } from './funding';
import { runAmmUpdater } from './amm';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require('../idl/perp_dex.json');

async function main() {
  console.log('PerpFlow Keeper starting...');
  const connection = new Connection(CLUSTER_URL, 'confirmed');
  const wallet = new anchor.Wallet(KEEPER_KEYPAIR);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl as anchor.Idl, provider);

  console.log(`Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`Keeper: ${KEEPER_KEYPAIR.publicKey.toString()}`);

  await Promise.all([
    runLiquidator(program, connection, KEEPER_KEYPAIR),
    runFundingSettler(program, connection, KEEPER_KEYPAIR),
    runAmmUpdater(program, connection, KEEPER_KEYPAIR),
  ]);
}

main().catch(console.error);
