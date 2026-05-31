"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFundingSettler = runFundingSettler;
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("./config");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getMarketPda(marketIndex, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(new Uint16Array([marketIndex]).buffer)], programId);
    return pda;
}
async function settleStalePositions(program, market, keeper) {
    const marketPda = getMarketPda(market.index, program.programId);
    const now = Math.floor(Date.now() / 1000);
    const positions = await program.account.position.all();
    for (const { publicKey: positionPda, account: position } of positions) {
        if (!position.isOpen)
            continue;
        if (position.market.toString() !== marketPda.toString())
            continue;
        const lastFundingTs = position.lastFundingTs.toNumber();
        const staleSecs = now - lastFundingTs;
        if (staleSecs > config_1.STALE_FUNDING_THRESHOLD_SECS) {
            try {
                await program.methods
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
            }
            catch (e) {
                const msg = e.message || String(e);
                if (!msg.includes('FundingTooRecent')) {
                    console.error(`[${market.name}] Funding settle error for ${positionPda.toString()}:`, msg);
                }
            }
        }
    }
}
async function runFundingSettler(program, _connection, keeperKeypair) {
    console.log('Funding settler started');
    while (true) {
        try {
            for (const market of config_1.MARKETS) {
                await settleStalePositions(program, market, keeperKeypair);
            }
        }
        catch (e) {
            console.error('Funding settler error:', e.message);
        }
        await sleep(config_1.FUNDING_SETTLE_INTERVAL_MS);
    }
}
