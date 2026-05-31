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
const web3_js_1 = require("@solana/web3.js");
const anchor = __importStar(require("@coral-xyz/anchor"));
const config_1 = require("./config");
const liquidator_1 = require("./liquidator");
const funding_1 = require("./funding");
const amm_1 = require("./amm");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require('../idl/perp_dex.json');
async function main() {
    console.log('PerpFlow Keeper starting...');
    const connection = new web3_js_1.Connection(config_1.CLUSTER_URL, 'confirmed');
    const wallet = new anchor.Wallet(config_1.KEEPER_KEYPAIR);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
    });
    anchor.setProvider(provider);
    const program = new anchor.Program(idl, provider);
    console.log(`Program ID: ${config_1.PROGRAM_ID.toString()}`);
    console.log(`Keeper: ${config_1.KEEPER_KEYPAIR.publicKey.toString()}`);
    await Promise.all([
        (0, liquidator_1.runLiquidator)(program, connection, config_1.KEEPER_KEYPAIR),
        (0, funding_1.runFundingSettler)(program, connection, config_1.KEEPER_KEYPAIR),
        (0, amm_1.runAmmUpdater)(program, connection, config_1.KEEPER_KEYPAIR),
    ]);
}
main().catch(console.error);
