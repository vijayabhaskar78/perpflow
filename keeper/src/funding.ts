import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FUNDING_SETTLE_INTERVAL_MS, MARKETS, STALE_FUNDING_THRESHOLD_SECS } from './config';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMarketPda(marketIndex: number, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([marketIndex]).buffer)],
    programId
  );
  return pda;
}

async function settleStalePositions(
  program: anchor.Program<any>,
  market: { index: number; name: string; oracle: PublicKey },
  keeper: Keypair
) {
  const marketPda = getMarketPda(market.index, program.programId);
  const now = Math.floor(Date.now() / 1000);

  const positions = await (program.account as any).position.all();

  for (const { publicKey: positionPda, account: position } of positions) {
    if (!position.isOpen) continue;
    if ((position.market as PublicKey).toString() !== marketPda.toString()) continue;

    const lastFundingTs = (position.lastFundingTs as anchor.BN).toNumber();
    const staleSecs = now - lastFundingTs;

    if (staleSecs > STALE_FUNDING_THRESHOLD_SECS) {
      try {
        await (program.methods as any)
          .settleFunding()
          .accounts({
            caller: keeper.publicKey,
            userAccount: position.userAccount,
            position: positionPda,
            market: marketPda,
            oracle: market.oracle,
          })
          .signers([keeper])
          .rpc();
        console.log(`[${market.name}] Settled funding for ${positionPda.toString()}`);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        if (!msg.includes('FundingTooRecent')) {
          console.error(`[${market.name}] Funding settle error for ${positionPda.toString()}:`, msg);
        }
      }
    }
  }
}

export async function runFundingSettler(
  program: anchor.Program<any>,
  _connection: Connection,
  keeperKeypair: Keypair
) {
  console.log('Funding settler started');
  while (true) {
    try {
      for (const market of MARKETS) {
        await settleStalePositions(program, market, keeperKeypair);
      }
    } catch (e) {
      console.error('Funding settler error:', (e as Error).message);
    }
    await sleep(FUNDING_SETTLE_INTERVAL_MS);
  }
}
