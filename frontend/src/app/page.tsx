'use client';
import { useState, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { WalletButton } from '../components/WalletButton';
import { MarketHeader } from '../components/MarketHeader';
import { OrderForm } from '../components/OrderForm';
import { PositionPanel } from '../components/PositionPanel';
import { CollateralModal } from '../components/CollateralModal';
import { FaucetButton } from '../components/FaucetButton';
import { useOraclePrice } from '../hooks/useOraclePrice';
import { usePosition } from '../hooks/usePosition';
import { useUserAccount } from '../hooks/useUserAccount';
import { getProgram, getMarketPda } from '../utils/anchor';
import { SOL_USD_FEED_ID } from '../utils/constants';
import { PublicKey } from '@solana/web3.js';

export default function TradingPage() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [showCollateral, setShowCollateral] = useState(false);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [quoteMint, setQuoteMint] = useState<PublicKey | null>(null);
  const [refresh, setRefresh] = useState(0);

  const indexPrice = useOraclePrice(SOL_USD_FEED_ID);

  const wallet = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return { publicKey, signTransaction, signAllTransactions } as anchor.Wallet;
  }, [publicKey, signTransaction, signAllTransactions]);

  const program = useMemo(() => {
    if (!wallet) return null;
    try { return getProgram(wallet); } catch { return null; }
  }, [wallet]);

  const userAccount = useUserAccount(program);
  const position = usePosition(program);

  useEffect(() => {
    if (!program) return;
    const fetchMarket = async () => {
      try {
        const marketPda = getMarketPda();
        const data = await (program.account as any).market.fetch(marketPda);
        const base = BigInt(data.baseAssetReserve.toString());
        const quote = BigInt(data.quoteAssetReserve.toString());
        if (base > 0n) setMarkPrice(Number((quote * 1_000_000_000n) / base) / 1e9);
        setQuoteMint(data.quoteMint);
      } catch {}
    };
    fetchMarket();
    const interval = setInterval(fetchMarket, 2000);
    return () => clearInterval(interval);
  }, [program, refresh]);

  const onSuccess = () => setRefresh(r => r + 1);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-blue-400">PerpFlow</h1>
          <span className="text-gray-400 text-sm">SOL/USD</span>
        </div>
        <div className="flex items-center gap-3">
          {program && quoteMint && (
            <FaucetButton program={program} usdcMint={quoteMint} />
          )}
          <button
            onClick={() => setShowCollateral(true)}
            className="text-sm px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
          >
            Deposit / Withdraw
          </button>
          <WalletButton />
        </div>
      </header>

      {/* Market Info Bar */}
      <MarketHeader
        markPrice={markPrice}
        indexPrice={indexPrice}
        openInterestLong={0}
        openInterestShort={0}
      />

      {/* Main Layout */}
      <div className="flex gap-4 p-4 max-w-7xl mx-auto">
        {/* Left: Chart placeholder + Position */}
        <div className="flex-1 space-y-4">
          <div className="bg-gray-900 rounded-lg h-64 flex items-center justify-center text-gray-600">
            <div className="text-center">
              <div className="text-4xl mb-2">{markPrice ? `$${markPrice.toFixed(2)}` : '--'}</div>
              <div className="text-sm">SOL/USD Mark Price</div>
              {indexPrice && (
                <div className="text-xs mt-1 text-gray-500">Index: ${indexPrice.toFixed(2)}</div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Your Position</h3>
            <PositionPanel
              program={program}
              position={position}
              markPrice={markPrice}
              onSuccess={onSuccess}
            />
          </div>

          {userAccount && (
            <div className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>Available Collateral</span>
                <span className="font-mono text-white">${(userAccount.collateral / 1e6).toFixed(2)} USDC</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Order Form */}
        <div className="w-80">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Place Order</h3>
          <OrderForm
            program={program}
            markPrice={markPrice}
            collateralBalance={userAccount?.collateral ?? 0}
            onSuccess={onSuccess}
          />
        </div>
      </div>

      {showCollateral && (
        <CollateralModal
          program={program}
          collateralBalance={userAccount?.collateral ?? 0}
          quoteMint={quoteMint}
          onSuccess={onSuccess}
          onClose={() => setShowCollateral(false)}
        />
      )}
    </div>
  );
}
