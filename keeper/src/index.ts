import { Connection, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createServer } from 'http';
import { CLUSTER_URL, PROGRAM_ID, KEEPER_KEYPAIR } from './config';
import { runLiquidator } from './liquidator';
import { runFundingSettler } from './funding';
import { runAmmUpdater } from './amm';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require('../idl/perp_dex.json');

function startHealthServer() {
  const port = Number(process.env.PORT || 10000);
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'perpflow-keeper' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('PerpFlow keeper is running\n');
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
}

async function main() {
  console.log('PerpFlow Keeper starting...');
  startHealthServer();

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
