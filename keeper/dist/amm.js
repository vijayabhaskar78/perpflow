"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAmmUpdater = runAmmUpdater;
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("./config");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getMarketPda(marketIndex, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(new Uint16Array([marketIndex]).buffer)], programId);
    return pda;
}
async function runAmmUpdater(program, _connection, keeper) {
    console.log('AMM updater started');
    while (true) {
        try {
            for (const market of config_1.MARKETS) {
                const marketPda = getMarketPda(market.index, program.programId);
                const marketAccount = await program.account.market.fetch(marketPda);
                const longOi = BigInt(marketAccount.openInterestLong.toString());
                const shortOi = BigInt(marketAccount.openInterestShort.toString());
                const totalOi = longOi + shortOi;
                if (totalOi === 0n)
                    continue;
                const imbalance = Number(longOi > shortOi ? longOi - shortOi : shortOi - longOi) / Number(totalOi);
                if (imbalance > 0.25) {
                    console.log(`[${market.name}] OI imbalance ${(imbalance * 100).toFixed(1)}%, updating AMM...`);
                    try {
                        await program.methods
                            .updateAmm()
                            .accounts({
                            caller: keeper.publicKey,
                            market: marketPda,
                            oracle: market.oracle,
                        })
                            .signers([keeper])
                            .rpc();
                        console.log(`[${market.name}] AMM updated`);
                    }
                    catch (e) {
                        console.error(`[${market.name}] AMM update error:`, e.message);
                    }
                }
            }
        }
        catch (e) {
            console.error('AMM updater error:', e.message);
        }
        await sleep(config_1.AMM_UPDATE_INTERVAL_MS);
    }
}
