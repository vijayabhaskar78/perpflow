import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const MARKET_INDEX = 0;
const SOL_USD_ORACLE = new anchor.web3.PublicKey(
  '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
);

async function main() {
  const connection = new anchor.web3.Connection('https://api.devnet.solana.com', 'confirmed');
  const payerKeyPath =
    process.env.KEYPAIR_PATH ||
    process.env.ANCHOR_WALLET ||
    path.join(__dirname, '..', 'deployer-keypair-2.json');
  const payer = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(payerKeyPath, 'utf-8')))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, '..', 'target', 'idl', 'perp_dex.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);
  const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
    program.programId
  );

  const signature = await (program.methods as any)
    .updateOracle()
    .accounts({
      authority: payer.publicKey,
      market: marketPda,
      oracle: SOL_USD_ORACLE,
    })
    .rpc();

  console.log('Updated oracle:', SOL_USD_ORACLE.toString());
  console.log('Market:', marketPda.toString());
  console.log('Signature:', signature);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
