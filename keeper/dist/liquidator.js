"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLiquidator = runLiquidator;
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const config_1 = require("./config");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getMarketPda(marketIndex, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(new Uint16Array([marketIndex]).buffer)], programId);
    return pda;
}
function calculateMarginRatio(position) {
    if (!position.openNotional || position.openNotional.toNumber() === 0)
        return 1000000;
    return (position.collateral.toNumber() * 1000000) / position.openNotional.toNumber();
}
async function liquidate(program, positionPda, position, market, keeper) {
    const marketPda = getMarketPda(market.index, program.programId);
    const userAccountPda = position.userAccount;
    const [vaultPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault'), marketPda.toBuffer()], program.programId);
    const marketAccount = await program.account.market.fetch(marketPda);
    const quoteMint = marketAccount.quoteMint;
    const connection = program.provider.connection;
    const keeperAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, keeper, quoteMint, keeper.publicKey);
    await program.methods
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
async function checkLiquidations(program, market, keeper) {
    const marketPda = getMarketPda(market.index, program.programId);
    const positions = await program.account.position.all();
    for (const { publicKey: positionPda, account: position } of positions) {
        if (!position.isOpen)
            continue;
        if (position.market.toString() !== marketPda.toString())
            continue;
        const marginRatio = calculateMarginRatio(position);
        if (marginRatio < config_1.MAINTENANCE_MARGIN_RATIO) {
            console.log(`[${market.name}] Liquidating position ${positionPda.toString()} margin=${(marginRatio / 10000).toFixed(2)}%`);
            try {
                await liquidate(program, positionPda, position, market, keeper);
                console.log(`[${market.name}] Liquidated ${positionPda.toString()}`);
            }
            catch (e) {
                console.error(`[${market.name}] Liquidation failed for ${positionPda.toString()}:`, e.message);
            }
        }
    }
}
async function runLiquidator(program, _connection, keeperKeypair) {
    console.log('Liquidator bot started');
    while (true) {
        try {
            for (const market of config_1.MARKETS) {
                await checkLiquidations(program, market, keeperKeypair);
            }
        }
        catch (e) {
            console.error('Liquidator error:', e.message);
        }
        await sleep(config_1.LIQUIDATION_POLL_MS);
    }
}
