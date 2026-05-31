import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AMM_UPDATE_INTERVAL_MS, MARKETS } from './config';

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

export async function runAmmUpdater(
  program: anchor.Program<any>,
  _connection: Connection,
  keeper: Keypair
) {
  console.log('AMM updater started');
  while (true) {
    try {
      for (const market of MARKETS) {
        const marketPda = getMarketPda(market.index, program.programId);
        const marketAccount = await (program.account as any).market.fetch(marketPda) as any;

        const longOi = BigInt(marketAccount.openInterestLong.toString());
        const shortOi = BigInt(marketAccount.openInterestShort.toString());
        const totalOi = longOi + shortOi;

        if (totalOi === 0n) continue;

        const imbalance = Number(longOi > shortOi ? longOi - shortOi : shortOi - longOi) / Number(totalOi);

        if (imbalance > 0.25) {
          console.log(`[${market.name}] OI imbalance ${(imbalance * 100).toFixed(1)}%, updating AMM...`);
          try {
            await (program.methods as any)
              .updateAmm()
              .accounts({
                caller: keeper.publicKey,
                market: marketPda,
                oracle: market.oracle,
              })
              .signers([keeper])
              .rpc();
            console.log(`[${market.name}] AMM updated`);
          } catch (e) {
            console.error(`[${market.name}] AMM update error:`, (e as Error).message);
          }
        }
      }
    } catch (e) {
      console.error('AMM updater error:', (e as Error).message);
    }
    await sleep(AMM_UPDATE_INTERVAL_MS);
  }
}
