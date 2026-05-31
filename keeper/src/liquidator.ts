import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { LIQUIDATION_POLL_MS, MARKETS, MAINTENANCE_MARGIN_RATIO } from './config';

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

function calculateMarginRatio(position: any): number {
  if (!position.openNotional || position.openNotional.toNumber() === 0) return 1_000_000;
  return (position.collateral.toNumber() * 1_000_000) / position.openNotional.toNumber();
}

async function liquidate(
  program: anchor.Program<any>,
  positionPda: PublicKey,
  position: any,
  market: { index: number; oracle: PublicKey; name: string },
  keeper: Keypair
) {
  const marketPda = getMarketPda(market.index, program.programId);
  const userAccountPda: PublicKey = position.userAccount;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    program.programId
  );

  const marketAccount = await (program.account as any).market.fetch(marketPda) as any;
  const quoteMint: PublicKey = marketAccount.quoteMint;

  const connection = program.provider.connection;
  const keeperAta = await getOrCreateAssociatedTokenAccount(
    connection,
    keeper,
    quoteMint,
    keeper.publicKey
  );

  await (program.methods as any)
    .liquidatePosition()
    .accounts({
      liquidator: keeper.publicKey,
      user: position.userAccount,
      userAccount: userAccountPda,
      position: positionPda,
      market: marketPda,
      vault: vaultPda,
      liquidatorTokenAccount: keeperAta.address,
      oracle: market.oracle,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([keeper])
    .rpc();
}

async function checkLiquidations(
  program: anchor.Program<any>,
  market: { index: number; name: string; oracle: PublicKey },
  keeper: Keypair
) {
  const marketPda = getMarketPda(market.index, program.programId);

  const positions = await (program.account as any).position.all();

  for (const { publicKey: positionPda, account: position } of positions) {
    if (!position.isOpen) continue;
    if ((position.market as PublicKey).toString() !== marketPda.toString()) continue;

    const marginRatio = calculateMarginRatio(position);

    if (marginRatio < MAINTENANCE_MARGIN_RATIO) {
      console.log(`[${market.name}] Liquidating position ${positionPda.toString()} margin=${(marginRatio / 10000).toFixed(2)}%`);
      try {
        await liquidate(program, positionPda, position, market, keeper);
        console.log(`[${market.name}] Liquidated ${positionPda.toString()}`);
      } catch (e) {
        console.error(`[${market.name}] Liquidation failed for ${positionPda.toString()}:`, (e as Error).message);
      }
    }
  }
}

export async function runLiquidator(
  program: anchor.Program<any>,
  _connection: Connection,
  keeperKeypair: Keypair
) {
  console.log('Liquidator bot started');
  while (true) {
    try {
      for (const market of MARKETS) {
        await checkLiquidations(program, market, keeperKeypair);
      }
    } catch (e) {
      console.error('Liquidator error:', (e as Error).message);
    }
    await sleep(LIQUIDATION_POLL_MS);
  }
}
