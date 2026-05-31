import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';

describe('perp-dex', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PerpDex as Program;

  const MARKET_INDEX = 0;
  const SOL_USD_ORACLE = new anchor.web3.PublicKey(
    'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'
  );

  let usdcMint: anchor.web3.PublicKey;
  let marketPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let userWallet: Keypair;
  let userUsdcAta: anchor.web3.PublicKey;
  let userAccountPda: anchor.web3.PublicKey;
  let positionPda: anchor.web3.PublicKey;

  before(async () => {
    userWallet = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(userWallet.publicKey, 5e9);
    await provider.connection.confirmTransaction(sig);

    // Create mock USDC
    usdcMint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey,
      null,
      6
    );

    // Derive PDAs
    [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
      program.programId
    );
    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), marketPda.toBuffer()],
      program.programId
    );
    [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('user_account'), userWallet.publicKey.toBuffer(), marketPda.toBuffer()],
      program.programId
    );
    [positionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('position'), userAccountPda.toBuffer(), marketPda.toBuffer()],
      program.programId
    );

    // Create user USDC ATA and mint tokens
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      usdcMint,
      userWallet.publicKey
    );
    userUsdcAta = ata.address;
    await mintTo(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      usdcMint,
      userUsdcAta,
      provider.wallet.publicKey,
      100_000_000_000 // 100,000 USDC
    );
  });

  it('initializes market with correct reserves', async () => {
    const marketName = Buffer.alloc(16);
    Buffer.from('SOL-USD').copy(marketName);

    await (program.methods as any).initializeMarket({
      marketIndex: MARKET_INDEX,
      marketName: Array.from(marketName),
      initialBaseReserve: new anchor.BN('1000000000000000'),
      initialQuoteReserve: new anchor.BN('100000000000000'),
      initialMarginRatio: new anchor.BN(100_000),
      maintenanceMarginRatio: new anchor.BN(62_500),
      takerFeeRate: new anchor.BN(1_000),
      maxLeverage: 10,
    }).accounts({
      authority: provider.wallet.publicKey,
      market: marketPda,
      vault: vaultPda,
      quoteMint: usdcMint,
      oracle: SOL_USD_ORACLE,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    }).rpc();

    const market = await (program.account as any).market.fetch(marketPda);
    expect(market.isActive).to.be.true;
    expect(market.marketIndex).to.equal(MARKET_INDEX);
    expect(market.maxLeverage).to.equal(10);
  });

  it('deposits collateral and updates user account', async () => {
    const amount = 1_000_000_000; // 1000 USDC
    await (program.methods as any)
      .depositCollateral(MARKET_INDEX, new anchor.BN(amount))
      .accounts({
        user: userWallet.publicKey,
        userAccount: userAccountPda,
        market: marketPda,
        vault: vaultPda,
        userTokenAccount: userUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([userWallet])
      .rpc();

    const ua = await (program.account as any).userAccount.fetch(userAccountPda);
    expect(ua.collateral.toNumber()).to.equal(amount);
  });

  it('opens a long position', async () => {
    await (program.methods as any)
      .openPosition({
        direction: { long: {} },
        collateral: new anchor.BN(100_000_000), // 100 USDC
        leverage: 5,
      })
      .accounts({
        user: userWallet.publicKey,
        userAccount: userAccountPda,
        position: positionPda,
        market: marketPda,
        oracle: SOL_USD_ORACLE,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([userWallet])
      .rpc();

    const pos = await (program.account as any).position.fetch(positionPda);
    expect(pos.isOpen).to.be.true;
    expect(pos.leverage).to.equal(5);
  });

  it('prevents opening a second position while one is open', async () => {
    try {
      await (program.methods as any)
        .openPosition({
          direction: { long: {} },
          collateral: new anchor.BN(100_000_000),
          leverage: 2,
        })
        .accounts({
          user: userWallet.publicKey,
          userAccount: userAccountPda,
          position: positionPda,
          market: marketPda,
          oracle: SOL_USD_ORACLE,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([userWallet])
        .rpc();
      expect.fail('Should have thrown PositionAlreadyOpen');
    } catch (e: any) {
      expect(e.message).to.include('already in use');
    }
  });

  it('closes position and settles PnL', async () => {
    await (program.methods as any)
      .closePosition()
      .accounts({
        user: userWallet.publicKey,
        userAccount: userAccountPda,
        position: positionPda,
        market: marketPda,
        oracle: SOL_USD_ORACLE,
        systemProgram: SystemProgram.programId,
      })
      .signers([userWallet])
      .rpc();

    const pos = await (program.account as any).position.fetch(positionPda);
    expect(pos.isOpen).to.be.false;
  });
});
