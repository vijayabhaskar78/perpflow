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
exports.STALE_FUNDING_THRESHOLD_SECS = exports.AMM_UPDATE_INTERVAL_MS = exports.FUNDING_SETTLE_INTERVAL_MS = exports.LIQUIDATION_POLL_MS = exports.MARKETS = exports.MAINTENANCE_MARGIN_RATIO = exports.KEEPER_KEYPAIR = exports.PROGRAM_ID = exports.CLUSTER_URL = void 0;
const anchor = __importStar(require("@coral-xyz/anchor"));
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
dotenv.config();
exports.CLUSTER_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
exports.PROGRAM_ID = new anchor.web3.PublicKey(process.env.PROGRAM_ID || '11111111111111111111111111111112');
const keeperKeypairJson = process.env.KEEPER_KEYPAIR && process.env.KEEPER_KEYPAIR !== '[]'
    ? process.env.KEEPER_KEYPAIR
    : fs.readFileSync(path.resolve(__dirname, '..', process.env.KEYPAIR_PATH || '../deployer-keypair.json'), 'utf-8');
exports.KEEPER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(Buffer.from(JSON.parse(keeperKeypairJson)));
exports.MAINTENANCE_MARGIN_RATIO = 62500;
exports.MARKETS = [
    {
        index: 0,
        name: 'SOL-USD',
        oracle: new anchor.web3.PublicKey(process.env.SOL_USD_ORACLE || 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'),
    },
];
exports.LIQUIDATION_POLL_MS = Number(process.env.LIQUIDATION_POLL_MS || 10000);
exports.FUNDING_SETTLE_INTERVAL_MS = 300000;
exports.AMM_UPDATE_INTERVAL_MS = 900000;
exports.STALE_FUNDING_THRESHOLD_SECS = 300;
