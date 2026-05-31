import * as anchor from '@coral-xyz/anchor';
import { createMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { Connection, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const INITIAL_BASE_RESERVE = new anchor.BN('1000000000000000');
const INITIAL_QUOTE_RESERVE = new anchor.BN('100000000000000');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payerKeyPath =
    process.env.KEYPAIR_PATH ||
    process.env.ANCHOR_WALLET ||
    path.join(__dirname, '..', 'deployer-keypair-2.json');
  const payerKey = JSON.parse(fs.readFileSync(payerKeyPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Buffer.from(payerKey));
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  // Load IDL
  const idlPath = path.join(__dirname, '..', 'target', 'idl', 'perp_dex.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const programId = new anchor.web3.PublicKey(idl.address);
  const program = new anchor.Program(idl, provider);

  console.log('Payer:', payer.publicKey.toString());
  console.log('Program ID:', programId.toString());

  // Check SOL balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`SOL balance: ${balance / 1e9}`);
  if (balance < 1e9) {
    console.log('Requesting airdrop...');
    const sig = await connection.requestAirdrop(payer.publicKey, 2e9);
    await connection.confirmTransaction(sig);
  }

  // Create mock USDC mint
  console.log('Creating mock USDC mint...');
  const usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log('Mock USDC mint:', usdcMint.toString());

  // Derive market PDA
  const MARKET_INDEX = 0;
  const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
    programId
  );
  const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    programId
  );

  const ORACLE = new anchor.web3.PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE');

  // Initialize market
  console.log('Initializing market...');
  const marketName = Buffer.alloc(16);
  Buffer.from('SOL-USD').copy(marketName);

  await (program.methods as any).initializeMarket({
    marketIndex: MARKET_INDEX,
    marketName: Array.from(marketName),
    initialBaseReserve: INITIAL_BASE_RESERVE,
    initialQuoteReserve: INITIAL_QUOTE_RESERVE,
    initialMarginRatio: new anchor.BN(100_000),
    maintenanceMarginRatio: new anchor.BN(62_500),
    takerFeeRate: new anchor.BN(1_000),
    maxLeverage: 10,
  }).accounts({
    authority: payer.publicKey,
    market: marketPda,
    vault: vaultPda,
    quoteMint: usdcMint,
    oracle: ORACLE,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).signers([payer]).rpc();

  console.log('Market initialized:', marketPda.toString());

  // Create user USDC ATA and mint some tokens
  const userAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, usdcMint, payer.publicKey
  );
  const { mintTo } = await import('@solana/spl-token');
  await mintTo(connection, payer, usdcMint, userAta.address, payer, 10_000_000_000);
  console.log('Minted 10,000 test USDC to:', userAta.address.toString());

  // Save config
  const config = {
    programId: programId.toString(),
    usdcMint: usdcMint.toString(),
    marketPda: marketPda.toString(),
    vaultPda: vaultPda.toString(),
    oracle: ORACLE.toString(),
  };
  fs.writeFileSync('devnet-config.json', JSON.stringify(config, null, 2));
  console.log('\nSaved to devnet-config.json');
  console.log('Update your .env files with:');
  console.log(`PROGRAM_ID=${programId.toString()}`);
  console.log(`NEXT_PUBLIC_PROGRAM_ID=${programId.toString()}`);
}

main().catch(console.error);
