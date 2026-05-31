# PerpFlow — On-Chain vAMM Perpetual Futures DEX on Solana
## Complete Technical Specification for Agent Build

---

## 0. Project Purpose & Context

PerpFlow is a fully on-chain perpetual futures exchange built on Solana using the Anchor framework. It enables leveraged long/short trading on crypto price pairs (SOL/USD, BTC/USD, ETH/USD) without a centralised counterparty, relying instead on a virtual AMM (vAMM) for price discovery and an automated keeper bot for protocol maintenance.

**Why this project exists:**
- Existing Solana perp DEXs (Drift, Zeta, Jupiter Perps) are production systems; PerpFlow is a clean-room implementation demonstrating the same core mechanisms with one novel addition: a dynamic-k parameter that adjusts the AMM invariant based on open interest imbalance, reducing slippage on the minority side and disincentivising over-concentration on the majority side.
- The full protocol lifecycle — deposit → open position → funding settlement → liquidation → close — is implemented and demonstrable on devnet with a running keeper bot.
- This is a capstone submission for a developer program. It must have a live devnet deployment, a working frontend, and a demo video.

**This document is the single source of truth. Build every component described here.**

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│                  User Browser                        │
│         Next.js 14 + Tailwind + shadcn/ui            │
│    @solana/wallet-adapter-react (Phantom/Backpack)   │
└─────────────────────┬────────────────────────────────┘
                      │ RPC calls (Solana devnet)
┌─────────────────────▼────────────────────────────────┐
│           Anchor Program: perp-dex                   │
│             (deployed to Solana devnet)               │
│                                                      │
│  State: Market / UserAccount / Position / Vault      │
│  Instructions: 8 (see §4)                            │
│  vAMM: dynamic-k virtual reserves                    │
│  Funding: continuous, lazy settlement                │
│  Liquidation: health-factor based                    │
└──────┬──────────────┬────────────────────────────────┘
       │              │
       │         ┌────▼──────────────────────────────┐
       │         │  Pyth Network (devnet oracles)     │
       │         │  SOL/USD: live price feeds         │
       │         └───────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────┐
│           Keeper Bot (Node.js / TypeScript)          │
│  Polls every 400ms                                   │
│  - Check every position for liquidation              │
│  - Settle funding for stale positions (>5 min)       │
│  - Update AMM k if OI imbalance >25%                 │
└─────────────────────────────────────────────────────┘
```

**Data flow summary:**
1. User connects Phantom/Backpack wallet on devnet
2. User receives devnet SOL via airdrop; mints test USDC via a faucet instruction
3. User deposits USDC → `deposit_collateral` → stored in on-chain Vault PDA
4. User opens long/short → `open_position` → vAMM updates reserves, Position account created
5. Pyth oracle continuously publishes index price on devnet
6. Keeper bot polls every 400ms: checks health of all positions, settles funding, adjusts k
7. If position health < 6.25%: keeper calls `liquidate_position`
8. User calls `close_position` to exit: vAMM reverses trade, PnL settled from Vault

---

## 2. Design Goals & Non-Goals

**Goals:**
- Fully on-chain (all state on Solana, no off-chain order book)
- Trustless execution (no admin keys in the critical path after initialization)
- Production patterns: Pyth oracle for price, keeper bot for automation, vAMM invariant for liquidity
- Dynamic-k vAMM: novel invariant adjustment based on OI imbalance
- Clean Anchor code with proper account validation and error handling
- Working devnet deployment with live frontend and keeper

**Non-goals:**
- Cross-margin (single isolated position per user per market for simplicity)
- Multiple positions in same market simultaneously
- Order types other than market (no limit orders)
- Governance / DAO / token
- Production security audit

---

## 3. Constants & Precision

All arithmetic in the Anchor program uses fixed-point integer math. **No floating point anywhere in the program.** The keeper bot may use floating point for off-chain calculations.

```rust
// In programs/perp-dex/src/constants.rs

// Precision factors
pub const PRICE_PRECISION: u128        = 1_000_000_000;     // 9 decimals. $100.00 = 100_000_000_000
pub const AMM_RESERVE_PRECISION: u128  = 1_000_000_000;     // 9 decimals. 1 SOL = 1_000_000_000
pub const FUNDING_PRECISION: u128      = 1_000_000_000_000; // 12 decimals
pub const RATIO_PRECISION: u64         = 1_000_000;         // 6 decimals. 100% = 1_000_000
pub const USDC_DECIMALS: u8            = 6;                 // USDC has 6 decimal places
pub const LAMPORTS_PER_USDC: u64       = 1_000_000;         // 1 USDC = 10^6 micro-USDC

// Margin parameters (expressed in RATIO_PRECISION = 6 decimals)
pub const INITIAL_MARGIN_RATIO: u64    = 100_000;  // 10.0% (= 100_000 / 1_000_000)
pub const MAINTENANCE_MARGIN_RATIO: u64 = 62_500;  // 6.25% (= 62_500 / 1_000_000)
pub const MAX_LEVERAGE: u8             = 10;        // 10x max leverage
pub const LIQUIDATION_FEE_RATIO: u64   = 12_500;   // 1.25% to liquidator
pub const INSURANCE_FEE_RATIO: u64     = 12_500;   // 1.25% to insurance fund

// Fee (in RATIO_PRECISION)
pub const TAKER_FEE_RATE: u64          = 1_000;    // 0.1% taker fee
pub const INSURANCE_FUND_SHARE: u64    = 800_000;  // 80% of fees go to insurance fund

// AMM parameters
pub const K_SENSITIVITY: u64           = 200_000;  // 20% (in RATIO_PRECISION). Sensitivity of k adjustment to OI imbalance.
pub const OI_IMBALANCE_THRESHOLD: u64  = 250_000;  // 25% threshold to trigger k update
pub const MAX_K_ADJUSTMENT: u64        = 300_000;  // Max ±30% k change per update

// Initial AMM reserves (for each market, set at initialization)
// These determine starting liquidity depth.
// SOL/USD market: price at ~$100 (can be set via init params)
pub const INITIAL_BASE_RESERVE: u128   = 1_000_000 * AMM_RESERVE_PRECISION; // 1M virtual SOL
pub const INITIAL_QUOTE_RESERVE: u128  = 100_000_000 * LAMPORTS_PER_USDC as u128; // 100M virtual USDC
// Invariant k = INITIAL_BASE_RESERVE * INITIAL_QUOTE_RESERVE

// Funding rate parameters
pub const MAX_FUNDING_RATE: i64        = 1_000;    // Max 0.1% per hour (in RATIO_PRECISION × 10^-6)
pub const FUNDING_PERIOD_SECS: i64     = 3600;     // 1 hour funding period

// Keeper parameters (used in keeper bot, not in program)
pub const LIQUIDATION_POLL_MS: u64     = 400;
pub const FUNDING_SETTLE_INTERVAL_MS: u64 = 300_000;  // 5 minutes
pub const AMM_UPDATE_INTERVAL_MS: u64  = 900_000;     // 15 minutes
pub const STALE_FUNDING_THRESHOLD_SECS: i64 = 300;    // Settle if >5 min since last settlement

// Slot / time
pub const SLOTS_PER_SECOND: u64 = 2;  // Solana ~400ms slots = 2.5/sec, approximate as 2
```

---

## 4. Error Codes

```rust
// In programs/perp-dex/src/error.rs

use anchor_lang::prelude::*;

#[error_code]
pub enum PerpError {
    // Auth
    #[msg("Unauthorized: caller is not the market authority")]
    Unauthorized,

    // Market
    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Market not initialized")]
    MarketNotInitialized,

    // Math
    #[msg("Math overflow in vAMM calculation")]
    MathOverflow,
    #[msg("Math underflow in vAMM calculation")]
    MathUnderflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Square root of zero is not defined in this context")]
    SqrtOfZero,

    // Position
    #[msg("Position is already open; close it before opening a new one")]
    PositionAlreadyOpen,
    #[msg("No open position exists for this user")]
    NoOpenPosition,
    #[msg("Collateral amount is zero")]
    ZeroCollateral,
    #[msg("Leverage exceeds maximum (10x)")]
    LeverageExceeded,
    #[msg("Notional size is below minimum order size")]
    OrderTooSmall,

    // Collateral
    #[msg("Insufficient collateral: amount requested exceeds free collateral")]
    InsufficientCollateral,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,

    // Liquidation
    #[msg("Position is healthy; cannot liquidate")]
    PositionHealthy,
    #[msg("Position is bankrupt; insurance fund covers remaining debt")]
    PositionBankrupt,

    // Oracle
    #[msg("Pyth oracle price is stale (>5 seconds old)")]
    OraclePriceStale,
    #[msg("Pyth oracle price confidence interval too wide")]
    OraclePriceConfidenceTooWide,
    #[msg("Pyth oracle price is negative or zero")]
    OraclePriceInvalid,

    // AMM
    #[msg("AMM reserves would become negative; trade size too large")]
    AmmReservesInvalid,
    #[msg("vAMM invariant (k) would change more than MAX_K_ADJUSTMENT")]
    KAdjustmentTooLarge,

    // Funding
    #[msg("Funding already settled recently; too soon to re-settle")]
    FundingTooRecent,
}
```

---

## 5. State Accounts

### 5.1 Market

The `Market` account is the central state for a single trading pair. It holds the vAMM reserves, OI tracking, fee pool, and all protocol parameters. There is one `Market` per trading pair.

```rust
// In programs/perp-dex/src/state/market.rs

use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Market {
    // --- Identity ---
    pub authority: Pubkey,          // Admin/protocol authority
    pub market_index: u16,          // Sequential ID (0 = SOL/USD, 1 = BTC/USD, 2 = ETH/USD)
    pub market_name: [u8; 16],      // ASCII name, e.g. b"SOL-USD\0\0\0\0\0\0\0\0\0"
    pub quote_mint: Pubkey,         // The USDC mint (or mock USDC mint)
    pub oracle: Pubkey,             // Pyth price feed account for this market
    pub vault: Pubkey,              // Vault token account PDA (holds real USDC)
    pub is_active: bool,            // Pausing switch for admin
    pub bump: u8,                   // PDA bump

    // --- vAMM reserves (all scaled by AMM_RESERVE_PRECISION = 10^9) ---
    pub base_asset_reserve: u128,   // Virtual base reserves (e.g., virtual SOL)
    pub quote_asset_reserve: u128,  // Virtual quote reserves (e.g., virtual USDC scaled)
    pub sqrt_k: u128,               // sqrt(base * quote), tracks current k
    // Note: k = base_asset_reserve * quote_asset_reserve
    // mark_price = quote_asset_reserve * PRICE_PRECISION / base_asset_reserve

    // --- Open Interest (base asset units, AMM_RESERVE_PRECISION) ---
    pub open_interest_long: u128,   // Total base units of long exposure
    pub open_interest_short: u128,  // Total base units of short exposure
    pub total_positions: u64,       // Counter of all open positions

    // --- Funding ---
    pub cumulative_funding_rate_long: i128,  // Cumulative funding rate for longs (FUNDING_PRECISION)
    pub cumulative_funding_rate_short: i128, // Cumulative funding rate for shorts (FUNDING_PRECISION)
    pub last_funding_ts: i64,               // Unix timestamp of last funding update
    pub last_mark_price_twap: u128,         // Mark price TWAP for funding calc (PRICE_PRECISION)
    pub last_mark_price_twap_ts: i64,       // Timestamp of last TWAP update

    // --- Fees & Insurance ---
    pub total_fee_collected: u64,           // Lifetime fees in USDC micro-units
    pub total_fee_minus_distributions: i64, // Net after payouts
    pub insurance_fund_balance: u64,        // Insurance fund in USDC micro-units

    // --- Protocol parameters ---
    pub initial_margin_ratio: u64,      // 10% = 100_000 (RATIO_PRECISION)
    pub maintenance_margin_ratio: u64,  // 6.25% = 62_500 (RATIO_PRECISION)
    pub taker_fee_rate: u64,            // 0.1% = 1_000 (RATIO_PRECISION)
    pub max_leverage: u8,               // 10

    // --- Padding for future fields ---
    pub _padding: [u64; 8],
}

impl Market {
    // Space: 8 (discriminator) + all fields. Calculate carefully.
    // Identity: 32+2+16+32+32+32+1+1 = 148
    // vAMM: 16+16+16 = 48
    // OI: 16+16+8 = 40
    // Funding: 16+16+8+16+8 = 64
    // Fees: 8+8+8 = 24
    // Params: 8+8+8+1 = 25
    // Padding: 64
    // Total: ~8 + 148 + 48 + 40 + 64 + 24 + 25 + 64 = ~421 bytes
    // Use SPACE = 512 to be safe
    pub const LEN: usize = 512;

    pub fn mark_price(&self) -> Result<u128> {
        // mark_price = quote_reserve * PRICE_PRECISION / base_reserve
        self.quote_asset_reserve
            .checked_mul(PRICE_PRECISION)
            .ok_or(PerpError::MathOverflow)?
            .checked_div(self.base_asset_reserve)
            .ok_or(PerpError::DivisionByZero)
            .map_err(Into::into)
    }
}
```

### 5.2 UserAccount

Tracks a user's deposited collateral balance in a market. Separate from positions.

```rust
// In programs/perp-dex/src/state/user_account.rs

#[account]
#[derive(Default)]
pub struct UserAccount {
    pub authority: Pubkey,      // Wallet public key
    pub market: Pubkey,         // Which market this account belongs to
    pub collateral: u64,        // Free (unallocated) collateral in USDC micro-units (10^-6 USDC)
    pub total_deposited: u64,   // Lifetime deposits
    pub total_withdrawn: u64,   // Lifetime withdrawals
    pub bump: u8,
    pub _padding: [u64; 4],
}

impl UserAccount {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 32 + 8; // ~137, use 192
}
```

### 5.3 Position

One position per user per market. Tracks direction, size, entry price, collateral allocation, and funding state.

```rust
// In programs/perp-dex/src/state/position.rs

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Direction {
    #[default]
    Long,
    Short,
}

#[account]
#[derive(Default)]
pub struct Position {
    // --- Identity ---
    pub user_account: Pubkey,       // Parent UserAccount
    pub market: Pubkey,             // Market this position is on
    pub is_open: bool,              // True if position is currently open
    pub direction: Direction,       // Long or Short
    pub bump: u8,

    // --- Size ---
    // base_asset_amount: how many virtual base units this position controls
    // For a long: positive, for a short: stored as positive but direction=Short
    // Scaled by AMM_RESERVE_PRECISION (10^9)
    pub base_asset_amount: u128,

    // open_notional: USDC value of the position at entry
    // = entry_price * base_asset_amount / PRICE_PRECISION
    // Stored in USDC micro-units (10^-6 USDC)
    pub open_notional: u64,

    // entry_price: mark price at position open (PRICE_PRECISION = 10^9)
    // e.g., $100.123456789 = 100_123_456_789
    pub entry_price: u128,

    // --- Collateral ---
    pub collateral: u64,            // USDC allocated to this position (micro-units)
    pub leverage: u8,               // Leverage used (1-10)

    // --- Funding ---
    // Snapshots the market's cumulative_funding_rate at position open
    // Used to calculate how much funding is owed since opening
    pub last_cumulative_funding_rate: i128, // (FUNDING_PRECISION)

    // --- Timestamps ---
    pub open_ts: i64,               // Unix timestamp when position was opened
    pub last_funding_ts: i64,       // Unix timestamp of last funding settlement

    // --- Tracking ---
    pub realized_pnl: i64,          // Cumulative realized PnL for this position
    pub total_funding_paid: i64,    // Cumulative funding paid (negative=received)

    // --- Padding ---
    pub _padding: [u64; 4],
}

impl Position {
    // Space: 8 + 32+32+1+1+1+1 + 16 + 8 + 16 + 8 + 1 + 16 + 8+8 + 8+8 + 32 = ~195, use 256
    pub const LEN: usize = 256;
}
```

---

## 6. Instruction Specifications

All instructions live in `programs/perp-dex/src/instructions/`. Each instruction has its own file with the Anchor `#[derive(Accounts)]` struct and the handler function.

### 6.1 `initialize_market`

**Who calls this:** Protocol admin only, once per market.

**Purpose:** Creates the Market account, sets initial vAMM reserves, creates the USDC vault.

```rust
// accounts struct
#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", market_index.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,

    // USDC token vault: a token account owned by the market PDA
    #[account(
        init,
        payer = authority,
        token::mint = quote_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub quote_mint: Account<'info, Mint>,      // USDC mint (or mock USDC)
    /// CHECK: Pyth price feed account; validated in instruction logic
    pub oracle: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// Parameters
pub struct InitializeMarketParams {
    pub market_index: u16,
    pub market_name: [u8; 16],          // e.g., b"SOL-USD\0\0\0\0\0\0\0\0\0"
    pub initial_base_reserve: u128,     // Starting base AMM reserves (AMM_RESERVE_PRECISION)
    pub initial_quote_reserve: u128,    // Starting quote AMM reserves
    pub initial_margin_ratio: u64,      // 100_000 = 10%
    pub maintenance_margin_ratio: u64,  // 62_500 = 6.25%
    pub taker_fee_rate: u64,            // 1_000 = 0.1%
    pub max_leverage: u8,               // 10
}

// Handler logic:
// 1. Validate oracle account is a valid Pyth price account (call get_price_no_older_than)
// 2. Verify initial_base_reserve * initial_quote_reserve will not overflow u128
// 3. Set market.base_asset_reserve = params.initial_base_reserve
// 4. Set market.quote_asset_reserve = params.initial_quote_reserve
// 5. Set market.sqrt_k = integer_sqrt(base * quote)
// 6. Copy all params into market state
// 7. Set market.is_active = true
// 8. Set market.vault = ctx.accounts.vault.key()
// 9. Set market.last_funding_ts = Clock::get()?.unix_timestamp
```

### 6.2 `deposit_collateral`

**Who calls this:** Any user.

**Purpose:** Transfer USDC from user's wallet token account to the vault; credit their UserAccount.

```rust
#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserAccount::LEN,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        seeds = [b"market", market_index.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == market.quote_mint
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// Handler logic:
// 1. Validate amount > 0
// 2. CPI: token::transfer from user_token_account → vault, amount = params.amount
// 3. user_account.collateral += params.amount
// 4. user_account.total_deposited += params.amount
// 5. If init_if_needed triggered: set user_account.authority = user.key(), user_account.market = market.key()
```

### 6.3 `withdraw_collateral`

**Who calls this:** Any user.

**Purpose:** Withdraw free (unallocated) collateral. Cannot withdraw margin locked in a position.

```rust
// Handler logic:
// 1. Validate amount > 0 and amount <= user_account.collateral
// 2. Ensure no open position, OR if open: ensure remaining free collateral after withdrawal still meets initial margin
//    - If position is open: free_collateral = user_account.collateral - position.collateral
//    - Require: amount <= free_collateral
// 3. CPI: token::transfer from vault → user_token_account (vault is PDA signer)
//    - Signer seeds for vault: [b"vault", market.key().as_ref(), &[vault_bump]]
// 4. user_account.collateral -= amount
// 5. user_account.total_withdrawn += amount
```

### 6.4 `open_position`

**Who calls this:** Any user with a UserAccount and sufficient collateral.

**Purpose:** Open a leveraged long or short position using the vAMM.

```rust
#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.authority == user.key()
    )]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        init,
        payer = user,
        space = Position::LEN,
        seeds = [b"position", user_account.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"market", market.market_index.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.is_active == true @ PerpError::MarketPaused
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth price account, validated in instruction
    pub oracle: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub struct OpenPositionParams {
    pub direction: Direction,   // Long or Short
    pub collateral: u64,        // USDC to allocate to this position (micro-units)
    pub leverage: u8,           // 1 to MAX_LEVERAGE
}

// Handler logic (detailed):
// 1. VALIDATION
//    a. Require params.collateral > 0
//    b. Require params.leverage >= 1 && params.leverage <= MAX_LEVERAGE
//    c. Require no existing open position: position.is_open == false (init means default false)
//    d. Require user_account.collateral >= params.collateral
//    e. Validate oracle: call validate_oracle(&ctx.accounts.oracle)
//       - Use pyth_solana_receiver_sdk::price_update::PriceUpdateV2 account
//       - Call price_update.get_price_no_older_than(&clock, 5, &feed_id)
//       - Require price > 0
//       - Require confidence < price / 20 (confidence < 5% of price)
//
// 2. APPLY PENDING FUNDING
//    Apply any pending funding to the user_account balance based on existing positions.
//    (No existing position here since we checked is_open == false, so skip.)
//
// 3. CALCULATE TRADE
//    notional = collateral * leverage (u64, in USDC micro-units)
//    Require notional >= MIN_NOTIONAL (e.g., 1_000_000 = $1.00)
//
//    Call amm::get_swap_output(market, direction, notional) → base_amount
//    This returns how many virtual base units the position controls.
//    See §7 for the full vAMM math.
//
// 4. CALCULATE ENTRY PRICE
//    entry_price = notional * PRICE_PRECISION / base_amount
//
// 5. CALCULATE AND DEDUCT TRADING FEE
//    fee = notional * taker_fee_rate / RATIO_PRECISION
//    insurance_portion = fee * INSURANCE_FUND_SHARE / RATIO_PRECISION
//    user_account.collateral -= fee
//    market.insurance_fund_balance += insurance_portion
//    market.total_fee_collected += fee
//
// 6. UPDATE vAMM RESERVES
//    Call amm::update_reserves(market, direction, notional, base_amount)
//    This mutates market.base_asset_reserve and market.quote_asset_reserve
//
// 7. UPDATE MARKET OI
//    match direction:
//      Long  => market.open_interest_long += base_amount
//      Short => market.open_interest_short += base_amount
//    market.total_positions += 1
//
// 8. INITIALIZE POSITION
//    position.user_account = user_account.key()
//    position.market = market.key()
//    position.is_open = true
//    position.direction = direction
//    position.base_asset_amount = base_amount
//    position.open_notional = notional
//    position.entry_price = entry_price
//    position.collateral = params.collateral
//    position.leverage = params.leverage
//    position.last_cumulative_funding_rate = match direction {
//        Long  => market.cumulative_funding_rate_long,
//        Short => market.cumulative_funding_rate_short,
//    }
//    position.open_ts = clock.unix_timestamp
//    position.last_funding_ts = clock.unix_timestamp
//    position.bump = ctx.bumps.position
//
// 9. DEDUCT COLLATERAL FROM USER ACCOUNT
//    user_account.collateral -= params.collateral (additional deduction for fee already done)
//
// 10. EMIT EVENT
//    emit!(PositionOpened { market, user, direction, base_amount, notional, entry_price, collateral, leverage })
```

### 6.5 `close_position`

**Who calls this:** The position owner.

**Purpose:** Close an open position, settle PnL, return collateral.

```rust
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.authority == user.key()
    )]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        seeds = [b"position", user_account.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        constraint = position.is_open == true @ PerpError::NoOpenPosition,
        constraint = position.user_account == user_account.key()
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth price account
    pub oracle: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// Handler logic:
// 1. Validate oracle (same as open_position)
// 2. SETTLE PENDING FUNDING
//    Apply funding payments since last_funding_ts (see §8 Funding)
//    Adjust position.collateral and user_account.collateral
// 3. REVERSE vAMM TRADE
//    Call amm::get_close_swap_output(market, position) → exit_notional
//    This returns USDC received (for long) or USDC paid (for short) to close at current vAMM price.
// 4. CALCULATE REALIZED PNL
//    match direction:
//      Long:  pnl = (i64)exit_notional - (i64)position.open_notional
//      Short: pnl = (i64)position.open_notional - (i64)exit_notional
//    position.realized_pnl += pnl
// 5. CALCULATE EXIT FEE
//    fee = exit_notional * taker_fee_rate / RATIO_PRECISION
// 6. SETTLE BALANCE TO USER ACCOUNT
//    returned_collateral = position.collateral as i64 + pnl - fee as i64
//    if returned_collateral > 0:
//        user_account.collateral += returned_collateral as u64
//        // If vault has enough: transfer from vault to user
//    else:
//        // Position is a total loss (rare, should be liquidated before this)
//        user_account.collateral += 0  // All collateral lost
// 7. UPDATE MARKET OI
//    match direction:
//      Long  => market.open_interest_long -= position.base_asset_amount
//      Short => market.open_interest_short -= position.base_asset_amount
//    market.total_positions -= 1
// 8. UPDATE vAMM RESERVES
//    Call amm::reverse_reserves(market, position) to restore reserves
// 9. CLOSE POSITION
//    position.is_open = false
//    (position account remains but is_open = false; could be closed/reclaimed with anchor close)
// 10. EMIT EVENT
//    emit!(PositionClosed { market, user, direction, pnl, exit_price, fee })
```

### 6.6 `liquidate_position`

**Who calls this:** Any keeper bot (permissionless).

**Purpose:** Close an unhealthy position, distribute penalty.

```rust
#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    /// The user whose position is being liquidated
    /// CHECK: validated via user_account
    pub user: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        seeds = [b"position", user_account.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        constraint = position.is_open == true @ PerpError::NoOpenPosition
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// The liquidator's USDC token account (receives liquidation fee)
    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key()
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Pyth
    pub oracle: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

// Handler logic:
// 1. Validate oracle
// 2. SETTLE PENDING FUNDING (applies before health check)
// 3. GET CURRENT MARK PRICE from oracle
// 4. CALCULATE UNREALIZED PNL
//    Call math::calculate_unrealized_pnl(position, mark_price) → unrealized_pnl: i64
// 5. CHECK HEALTH
//    margin_ratio = (position.collateral as i64 + unrealized_pnl) * RATIO_PRECISION as i64
//                   / position.open_notional as i64
//    Require margin_ratio < market.maintenance_margin_ratio → error if healthy
// 6. CLOSE vAMM POSITION
//    Call amm::reverse_reserves() to close position
//    exit_notional = what vAMM returns
// 7. CALCULATE PNL
//    pnl = match direction { Long => exit_notional - open_notional, Short => open_notional - exit_notional }
// 8. CALCULATE REMAINING COLLATERAL
//    remaining = position.collateral as i64 + pnl
//    If remaining <= 0: position is bankrupt
//        market.insurance_fund_balance pays the deficit
//        remaining = 0
// 9. DISTRIBUTE PENALTY (from remaining collateral)
//    liquidator_fee = remaining * LIQUIDATION_FEE_RATIO / RATIO_PRECISION
//    insurance_fee = remaining * INSURANCE_FEE_RATIO / RATIO_PRECISION
//    leftover = remaining - liquidator_fee - insurance_fee
//    user_account.collateral += leftover (if any)
// 10. TRANSFER LIQUIDATOR FEE from vault → liquidator_token_account
// 11. UPDATE INSURANCE FUND
//    market.insurance_fund_balance += insurance_fee
// 12. UPDATE OI, CLOSE POSITION (same as close_position steps 7-9)
// 13. EMIT EVENT
//    emit!(PositionLiquidated { user, liquidator, pnl, remaining_collateral, liquidator_fee })
```

### 6.7 `settle_funding`

**Who calls this:** Keeper bot for a specific position (lazy settlement).

**Purpose:** Apply accumulated funding payments to a position's collateral.

```rust
#[derive(Accounts)]
pub struct SettleFunding<'info> {
    // Permissionless: any caller can settle funding for any position
    pub caller: Signer<'info>,

    #[account(mut)]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        constraint = position.is_open == true,
        constraint = position.user_account == user_account.key()
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth
    pub oracle: AccountInfo<'info>,
}

// Handler logic:
// 1. Get current time: now = Clock::get()?.unix_timestamp
// 2. Require now - position.last_funding_ts > STALE_FUNDING_THRESHOLD_SECS (300s)
//    Otherwise: return early (not an error, keeper will retry)
// 3. CALCULATE AND UPDATE MARKET FUNDING RATE
//    index_price = get_oracle_price(oracle)
//    mark_price = market.mark_price()
//    funding_rate = calculate_funding_rate(mark_price, index_price)
//    market.cumulative_funding_rate_long += funding_rate (if positive = longs pay)
//    market.cumulative_funding_rate_short -= funding_rate (shorts receive)
//    If negative: reverse (shorts pay, longs receive)
//    market.last_funding_ts = now
// 4. CALCULATE POSITION FUNDING PAYMENT
//    cumulative_rate = match direction {
//        Long  => market.cumulative_funding_rate_long,
//        Short => market.cumulative_funding_rate_short,
//    }
//    rate_delta = cumulative_rate - position.last_cumulative_funding_rate
//    funding_payment = (position.base_asset_amount * rate_delta) / FUNDING_PRECISION
//    // Positive = user pays; Negative = user receives
// 5. APPLY PAYMENT
//    if funding_payment > 0:
//        deduct from position.collateral and user_account.collateral
//    else:
//        add to position.collateral and user_account.collateral
// 6. UPDATE POSITION
//    position.last_cumulative_funding_rate = cumulative_rate
//    position.last_funding_ts = now
//    position.total_funding_paid += funding_payment
// 7. EMIT EVENT
//    emit!(FundingSettled { market, user, funding_payment, funding_rate })
```

### 6.8 `update_amm`

**Who calls this:** Keeper bot (permissionless), max once per AMM_UPDATE_INTERVAL_MS.

**Purpose:** Adjust vAMM k-parameter based on OI imbalance to reduce directional risk.

```rust
#[derive(Accounts)]
pub struct UpdateAmm<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: Pyth
    pub oracle: AccountInfo<'info>,
}

// Handler logic:
// 1. Validate oracle
// 2. Require market.last_funding_ts <= now - AMM_UPDATE_INTERVAL_SECS (don't update too often)
//    (Reuse last_funding_ts or add a dedicated last_amm_update_ts field)
// 3. Calculate OI imbalance
//    total_oi = market.open_interest_long + market.open_interest_short
//    If total_oi == 0: return early (no positions)
//    long_ratio = market.open_interest_long * RATIO_PRECISION / total_oi
//    short_ratio = RATIO_PRECISION - long_ratio
//    imbalance = abs(long_ratio as i64 - 500_000 as i64) * 2  // 0 = balanced, 1_000_000 = fully one-sided
//    If imbalance < OI_IMBALANCE_THRESHOLD: return early (balanced enough)
// 4. Calculate k adjustment
//    // When longs > shorts, increase k slightly (more expensive to go long, cheaper to go short)
//    // Signed imbalance: positive = long heavy, negative = short heavy
//    signed_imbalance = long_ratio as i64 - 500_000 as i64  // range -500_000 to +500_000
//    k_adjustment = signed_imbalance * K_SENSITIVITY as i64 / RATIO_PRECISION as i64
//    // k_adjustment is in the range [-0.1, +0.1] (10% max per update)
//    // Clamp to MAX_K_ADJUSTMENT
//    k_adjustment = clamp(k_adjustment, -(MAX_K_ADJUSTMENT as i64), MAX_K_ADJUSTMENT as i64)
// 5. Scale reserves
//    // scale = sqrt(1 + k_adjustment / RATIO_PRECISION)
//    // Using integer approximation: scale ≈ 1 + k_adjustment / (2 * RATIO_PRECISION) for small adjustments
//    // For precision: compute via integer_sqrt
//    new_sqrt_k = integer_sqrt(market.base_asset_reserve) * integer_sqrt(market.quote_asset_reserve)
//    // Apply scale to both reserves to preserve mark price
//    // new_base = base * scale, new_quote = quote * scale
//    // scale = (RATIO_PRECISION + k_adjustment/2) / RATIO_PRECISION for first-order approx
//    numerator = (RATIO_PRECISION as i64 + k_adjustment / 2) as u128
//    market.base_asset_reserve = market.base_asset_reserve * numerator / RATIO_PRECISION as u128
//    market.quote_asset_reserve = market.quote_asset_reserve * numerator / RATIO_PRECISION as u128
//    market.sqrt_k = integer_sqrt(market.base_asset_reserve * market.quote_asset_reserve)
// 6. EMIT EVENT
//    emit!(AmmUpdated { market, old_k, new_k, imbalance, k_adjustment })
```

### 6.9 `mint_test_usdc` (Faucet — devnet only)

**Purpose:** Lets anyone mint test USDC for testing. Gated by a `devnet_only` flag in program config.

```rust
// Handler logic:
// 1. CPI to token program: mint_to(user_token_account, amount)
//    Uses mint authority = program-controlled PDA [b"mint_authority"]
// 2. Amount is fixed: 10_000 USDC per call (10_000_000_000 micro-USDC)
// 3. Add per-user per-day cooldown (optional for hackathon)
```

---

## 7. vAMM Math Module

All vAMM math is in `programs/perp-dex/src/math/amm.rs`. These functions are pure (no account mutations — they just compute outputs). Mutations happen in the instruction handlers.

### 7.1 Core Invariant

The vAMM maintains:
```
k = base_asset_reserve × quote_asset_reserve
```

This is the standard constant-product invariant. k is stored as a `u128` to avoid overflow.

The mark price at any point is:
```
mark_price = quote_asset_reserve × PRICE_PRECISION / base_asset_reserve
```

### 7.2 Swap Output for Opening Long

When a user opens a LONG with `quote_in` USDC notional:
```
new_quote_reserve = quote_asset_reserve + quote_in
new_base_reserve = k / new_quote_reserve         (integer division, precision-scaled)
base_acquired = base_asset_reserve - new_base_reserve
```
The position controls `base_acquired` units of base asset.

Entry price = `quote_in × PRICE_PRECISION / base_acquired`

```rust
pub fn calculate_long_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    quote_in: u128,  // scaled by LAMPORTS_PER_USDC
) -> Result<(u128, u128, u128)> {
    // Returns (base_acquired, new_base_reserve, new_quote_reserve)
    let new_quote = quote_reserve.checked_add(quote_in).ok_or(PerpError::MathOverflow)?;
    let new_base = k.checked_div(new_quote).ok_or(PerpError::DivisionByZero)?;
    let base_out = base_reserve.checked_sub(new_base).ok_or(PerpError::AmmReservesInvalid)?;
    Ok((base_out, new_base, new_quote))
}
```

### 7.3 Swap Output for Opening Short

When a user opens a SHORT with `quote_notional` USDC of exposure:
- The user is "selling" base. We compute how much base they'd need to sell to get that notional.
- `base_in = quote_notional × AMM_RESERVE_PRECISION / mark_price`
```
new_base_reserve = base_asset_reserve + base_in
new_quote_reserve = k / new_base_reserve
quote_acquired = quote_asset_reserve - new_quote_reserve
```

```rust
pub fn calculate_short_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    quote_notional: u128,
    mark_price: u128,  // PRICE_PRECISION scaled
) -> Result<(u128, u128, u128)> {
    // base_in = quote_notional * AMM_RESERVE_PRECISION / mark_price
    let base_in = quote_notional
        .checked_mul(AMM_RESERVE_PRECISION)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(mark_price)
        .ok_or(PerpError::DivisionByZero)?;
    let new_base = base_reserve.checked_add(base_in).ok_or(PerpError::MathOverflow)?;
    let new_quote = k.checked_div(new_base).ok_or(PerpError::DivisionByZero)?;
    let quote_out = quote_reserve.checked_sub(new_quote).ok_or(PerpError::AmmReservesInvalid)?;
    Ok((base_in, new_base, new_quote))
    // The position controls base_in units, and has open_notional = quote_out (≈ quote_notional with slippage)
}
```

### 7.4 Closing a Long

Reverse the long trade:
```
new_base_reserve = base_asset_reserve + base_amount_held
new_quote_reserve = k / new_base_reserve
quote_received = quote_asset_reserve - new_quote_reserve
```

### 7.5 Closing a Short

Reverse the short trade:
```
new_quote_reserve = quote_asset_reserve + open_notional_at_entry
new_base_reserve = k / new_quote_reserve
base_returned = base_asset_reserve - new_base_reserve
quote_cost = open_notional
```
(The exact exit quote depends on current reserves, not entry. Use the reverse formula.)

### 7.6 Unrealized PnL

```rust
pub fn calculate_unrealized_pnl(
    direction: Direction,
    base_asset_amount: u128,
    open_notional: u64,
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
) -> Result<i64> {
    // Simulate closing to get exit_notional
    let exit_notional = match direction {
        Direction::Long  => {
            let (_, new_base, new_quote) = /* simulate long close */ ...;
            // exit_notional = quote_reserve - new_quote
            (quote_reserve - new_quote) as u64
        },
        Direction::Short => {
            // exit_notional = new_base_reserve * mark / AMM_PRECISION (cost to rebuy)
            // Or: reverse the short formula
            ...
        }
    };
    let pnl = match direction {
        Direction::Long  => exit_notional as i64 - open_notional as i64,
        Direction::Short => open_notional as i64 - exit_notional as i64,
    };
    Ok(pnl)
}
```

### 7.7 Integer Square Root

Used in `update_amm` and general k calculations:
```rust
pub fn integer_sqrt(n: u128) -> u128 {
    if n == 0 { return 0; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
```

---

## 8. Oracle Integration (Pyth Network)

Use `pyth-solana-receiver-sdk` (Pyth V2, Pull Oracle model).

### 8.1 Devnet Price Feed IDs

These are the Pyth devnet price feed IDs as hex strings. Pass as `feed_id` to `get_price_no_older_than`.

```
SOL/USD: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
BTC/USD: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ETH/USD: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
```

### 8.2 Price Validation Function

```rust
// In programs/perp-dex/src/math/oracle.rs

use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

pub fn validate_and_get_price(
    price_update: &AccountInfo,
    feed_id_hex: &str,
    clock: &Clock,
) -> Result<u128> {
    let price_update_data: Account<PriceUpdateV2> = Account::try_from(price_update)?;
    let feed_id = get_feed_id_from_hex(feed_id_hex)?;

    // Price must be no older than 5 seconds
    let price = price_update_data
        .get_price_no_older_than(clock, 5, &feed_id)
        .map_err(|_| PerpError::OraclePriceStale)?;

    // Confidence must be < 5% of price
    require!(price.conf < (price.price.abs() as u64) / 20, PerpError::OraclePriceConfidenceTooWide);
    require!(price.price > 0, PerpError::OraclePriceInvalid);

    // Convert Pyth price (expo typically -8) to PRICE_PRECISION (10^9)
    // Pyth price × 10^(9 - (-expo)) / 10^9 = price × 10^(9 + expo)
    // expo is negative (e.g., -8), so: price × 10^(9-8) = price × 10
    let price_scaled = if price.exponent >= 0 {
        (price.price as u128) * (10u128.pow(9 + price.exponent as u32))
    } else {
        let exp = (-price.exponent) as u32;
        if exp <= 9 {
            (price.price as u128) * (10u128.pow(9 - exp))
        } else {
            (price.price as u128) / (10u128.pow(exp - 9))
        }
    };

    Ok(price_scaled)
}
```

### 8.3 Oracle Account in Each Instruction

Each instruction that needs the current index price (open_position, close_position, liquidate_position, settle_funding, update_amm) must include the Pyth price feed account.

**Constraint in Accounts struct:**
```rust
/// CHECK: Verified by validate_and_get_price call in handler
#[account(
    constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid
)]
pub oracle: AccountInfo<'info>,
```

---

## 9. Funding Rate Mechanism

### 9.1 Formula

Funding rate is computed per settlement call:

```
funding_rate_hourly = (mark_price - index_price) × FUNDING_PRECISION
                      ────────────────────────────────────────────────
                                    index_price × 24
```

This is equivalent to: "if mark is 1% above index, longs pay 1%/24 ≈ 0.0417% per hour."

Capped at ±MAX_FUNDING_RATE per hour.

### 9.2 Cumulative Rate

The market stores `cumulative_funding_rate_long` and `cumulative_funding_rate_short` as `i128`. These increase/decrease monotonically over time.

At any funding settlement:
```rust
let time_elapsed = now - market.last_funding_ts;  // in seconds
let periods = time_elapsed as i128 * FUNDING_PRECISION as i128 / FUNDING_PERIOD_SECS as i128;

let raw_rate = (mark_price as i128 - index_price as i128)
    * FUNDING_PRECISION as i128
    / (index_price as i128 * 24);
let rate_this_period = clamp(raw_rate, -MAX_FUNDING_RATE as i128, MAX_FUNDING_RATE as i128);
let rate_accumulated = rate_this_period * periods / FUNDING_PRECISION as i128;

market.cumulative_funding_rate_long += rate_accumulated;
market.cumulative_funding_rate_short -= rate_accumulated;
```

### 9.3 Position Funding Payment

```rust
let rate_delta = match direction {
    Long  => market.cumulative_funding_rate_long - position.last_cumulative_funding_rate,
    Short => market.cumulative_funding_rate_short - position.last_cumulative_funding_rate,
};

// funding_payment: positive = user pays out (collateral decreases)
//                  negative = user receives (collateral increases)
let funding_payment: i64 = (position.base_asset_amount as i128
    * rate_delta
    / FUNDING_PRECISION as i128) as i64;
```

Apply funding payment:
```rust
if funding_payment > 0 {
    // User pays; deduct from collateral
    // If collateral insufficient → position is unhealthy, keeper should liquidate
    position.collateral = position.collateral.saturating_sub(funding_payment as u64);
} else {
    // User receives
    position.collateral += (-funding_payment) as u64;
    user_account.collateral += (-funding_payment) as u64;
}
position.last_cumulative_funding_rate = match direction { ... };
position.last_funding_ts = now;
```

---

## 10. Liquidation System

### 10.1 Health Factor Calculation

```rust
pub fn calculate_health(
    collateral: u64,
    unrealized_pnl: i64,
    open_notional: u64,
) -> u64 {
    // margin_ratio in RATIO_PRECISION (10^6)
    // = (collateral + unrealized_pnl) / open_notional × RATIO_PRECISION
    let effective_collateral = collateral as i64 + unrealized_pnl;
    if effective_collateral <= 0 || open_notional == 0 {
        return 0;
    }
    (effective_collateral as u128 * RATIO_PRECISION as u128 / open_notional as u128) as u64
}
```

A position is liquidatable when `margin_ratio < MAINTENANCE_MARGIN_RATIO` (62,500 = 6.25%).

### 10.2 Liquidation Proceeds Distribution

After closing the position via vAMM:
```
remaining = collateral + realized_pnl  (can be negative → bankrupt)

If remaining < 0:
    deficit = -remaining
    market.insurance_fund_balance -= deficit  (insurance absorbs loss)
    remaining = 0

liquidator_fee = remaining × LIQUIDATION_FEE_RATIO / RATIO_PRECISION  (1.25%)
insurance_fee  = remaining × INSURANCE_FEE_RATIO  / RATIO_PRECISION   (1.25%)
user_return    = remaining - liquidator_fee - insurance_fee            (97.5%)

Transfer liquidator_fee from vault to liquidator_token_account
user_account.collateral += user_return
market.insurance_fund_balance += insurance_fee
```

---

## 11. Events

```rust
// In programs/perp-dex/src/events.rs

#[event]
pub struct PositionOpened {
    pub market: Pubkey,
    pub user: Pubkey,
    pub direction: Direction,
    pub base_asset_amount: u128,
    pub open_notional: u64,
    pub entry_price: u128,
    pub collateral: u64,
    pub leverage: u8,
    pub timestamp: i64,
}

#[event]
pub struct PositionClosed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub direction: Direction,
    pub realized_pnl: i64,
    pub exit_price: u128,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct PositionLiquidated {
    pub market: Pubkey,
    pub user: Pubkey,
    pub liquidator: Pubkey,
    pub realized_pnl: i64,
    pub remaining_collateral: u64,
    pub liquidator_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct FundingSettled {
    pub market: Pubkey,
    pub user: Pubkey,
    pub funding_payment: i64,
    pub funding_rate: i64,
    pub timestamp: i64,
}

#[event]
pub struct AmmUpdated {
    pub market: Pubkey,
    pub old_sqrt_k: u128,
    pub new_sqrt_k: u128,
    pub imbalance_bps: i64,  // in basis points
    pub timestamp: i64,
}

#[event]
pub struct CollateralDeposited {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}
```

---

## 12. Complete File Structure

```
perp-dex/
├── Anchor.toml
├── Cargo.toml (workspace)
├── README.md
│
├── programs/
│   └── perp-dex/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                  ← Program entrypoint, #[program] macro, instruction routing
│           ├── constants.rs            ← All numeric constants (see §3)
│           ├── error.rs                ← PerpError enum (see §4)
│           ├── events.rs               ← All #[event] structs (see §11)
│           ├── state/
│           │   ├── mod.rs              ← pub mod market, position, user_account;
│           │   ├── market.rs           ← Market account struct + impl (see §5.1)
│           │   ├── position.rs         ← Position + Direction (see §5.3)
│           │   └── user_account.rs     ← UserAccount struct (see §5.2)
│           ├── instructions/
│           │   ├── mod.rs              ← pub mod for all instructions
│           │   ├── initialize_market.rs
│           │   ├── deposit_collateral.rs
│           │   ├── withdraw_collateral.rs
│           │   ├── open_position.rs
│           │   ├── close_position.rs
│           │   ├── liquidate_position.rs
│           │   ├── settle_funding.rs
│           │   ├── update_amm.rs
│           │   └── mint_test_usdc.rs   ← Devnet faucet
│           └── math/
│               ├── mod.rs              ← pub mod amm, oracle, funding, pnl;
│               ├── amm.rs              ← vAMM swap calculations (see §7)
│               ├── oracle.rs           ← Pyth price validation (see §8)
│               ├── funding.rs          ← Funding rate calculations (see §9)
│               └── pnl.rs              ← PnL, health factor calculations (see §10)
│
├── keeper/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    ← Main loop, starts all three sub-bots
│       ├── config.ts                   ← RPC URL, program ID, keypair, market addresses
│       ├── client.ts                   ← Anchor IDL client setup
│       ├── liquidator.ts               ← Polls positions, triggers liquidate_position
│       ├── funding.ts                  ← Polls positions with stale funding, settles
│       └── amm.ts                      ← Monitors OI imbalance, calls update_amm
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── next.config.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx              ← Root layout, WalletProvider wrapper
│       │   ├── page.tsx                ← Main trading page (single page app)
│       │   └── globals.css
│       ├── components/
│       │   ├── WalletButton.tsx        ← Phantom/Backpack connect
│       │   ├── MarketHeader.tsx        ← Mark price, index, funding rate, OI display
│       │   ├── PriceChart.tsx          ← Lightweight Charts price display (using Pyth)
│       │   ├── OrderForm.tsx           ← Direction, collateral, leverage slider, trade button
│       │   ├── PositionPanel.tsx       ← Current position, PnL, close button
│       │   ├── FundingDisplay.tsx      ← Current funding rate, next settlement countdown
│       │   ├── CollateralModal.tsx     ← Deposit/Withdraw USDC modal
│       │   └── FaucetButton.tsx        ← Mint test USDC button
│       ├── hooks/
│       │   ├── useMarket.ts            ← Subscribe to market account, re-render on change
│       │   ├── usePosition.ts          ← Fetch and subscribe to user's position
│       │   ├── useUserAccount.ts       ← Fetch user account, collateral balance
│       │   └── useOraclePrice.ts       ← Pyth Hermes WebSocket for live price
│       ├── utils/
│       │   ├── anchor.ts               ← Program setup, IDL, provider
│       │   ├── math.ts                 ← Frontend display math (price formatting, PnL display)
│       │   └── constants.ts            ← Program ID, market addresses, feed IDs
│       └── idl/
│           └── perp_dex.json           ← Generated by `anchor build` — copy here
│
└── tests/
    └── perp-dex.ts                     ← Anchor integration tests (see §16)
```

---

## 13. Cargo.toml (Program)

```toml
# programs/perp-dex/Cargo.toml
[package]
name = "perp-dex"
version = "0.1.0"
description = "PerpFlow: On-chain vAMM perpetual futures DEX"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "perp_dex"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
devnet = []   # enables mint_test_usdc faucet instruction

[dependencies]
anchor-lang = { version = "0.31.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.31.1", features = ["token"] }
pyth-solana-receiver-sdk = "0.3.0"

[dev-dependencies]
anchor-client = "0.31.1"
```

### Workspace Cargo.toml

```toml
# Cargo.toml (root)
[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "thin"
opt-level = 3
incremental = false

[profile.release.build-override]
opt-level = 3
incremental = false
```

---

## 14. Anchor.toml

```toml
[features]
seeds = true
skip-lint = false

[programs.devnet]
perp_dex = "<PROGRAM_ID_AFTER_anchor build>"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"  # or path to deployer keypair

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[test.validator]
url = "https://api.devnet.solana.com"
```

---

## 15. Keeper Bot

### 15.1 `keeper/package.json`

```json
{
  "name": "perp-dex-keeper",
  "version": "1.0.0",
  "description": "Keeper bot for PerpFlow protocol",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/web3.js": "^1.98.0",
    "@solana/spl-token": "^0.4.9",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0"
  }
}
```

### 15.2 `keeper/src/config.ts`

```typescript
import * as anchor from '@coral-xyz/anchor';
import * as dotenv from 'dotenv';
dotenv.config();

export const CLUSTER_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
export const PROGRAM_ID = new anchor.web3.PublicKey(process.env.PROGRAM_ID!);
export const KEEPER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
  Buffer.from(JSON.parse(process.env.KEEPER_KEYPAIR!))
);

// Market indices to monitor
export const MARKETS = [
  {
    index: 0,
    name: 'SOL-USD',
    oracle: new anchor.web3.PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'), // devnet SOL/USD Pyth
  },
  // Add BTC-USD, ETH-USD as needed
];

// Polling intervals
export const LIQUIDATION_POLL_MS = 400;
export const FUNDING_SETTLE_INTERVAL_MS = 300_000;
export const AMM_UPDATE_INTERVAL_MS = 900_000;
export const STALE_FUNDING_THRESHOLD_SECS = 300;
```

### 15.3 `keeper/src/index.ts`

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { CLUSTER_URL, PROGRAM_ID, KEEPER_KEYPAIR } from './config';
import { runLiquidator } from './liquidator';
import { runFundingSettler } from './funding';
import { runAmmUpdater } from './amm';
import idl from '../idl/perp_dex.json';

async function main() {
  console.log('PerpFlow Keeper starting...');
  const connection = new Connection(CLUSTER_URL, 'confirmed');
  const wallet = new anchor.Wallet(KEEPER_KEYPAIR);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

  // Run all three bots concurrently
  await Promise.all([
    runLiquidator(program, connection, KEEPER_KEYPAIR),
    runFundingSettler(program, connection, KEEPER_KEYPAIR),
    runAmmUpdater(program, connection, KEEPER_KEYPAIR),
  ]);
}

main().catch(console.error);
```

### 15.4 `keeper/src/liquidator.ts`

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { LIQUIDATION_POLL_MS, MARKETS, MAINTENANCE_MARGIN_RATIO } from './config';

const RATIO_PRECISION = 1_000_000n;
const PRICE_PRECISION = 1_000_000_000n;

export async function runLiquidator(
  program: anchor.Program,
  connection: Connection,
  keeperKeypair: Keypair
) {
  console.log('Liquidator bot started');
  while (true) {
    try {
      for (const market of MARKETS) {
        await checkLiquidations(program, market, keeperKeypair);
      }
    } catch (e) {
      console.error('Liquidator error:', e);
    }
    await sleep(LIQUIDATION_POLL_MS);
  }
}

async function checkLiquidations(
  program: anchor.Program,
  market: { index: number; name: string; oracle: PublicKey },
  keeper: Keypair
) {
  // Fetch all open positions for this market
  const positions = await program.account.position.all([
    {
      memcmp: {
        offset: 8 + 32 + 32 + 1,  // is_open field offset — adjust based on actual struct layout
        bytes: anchor.utils.bytes.bs58.encode(Buffer.from([1])), // is_open = true
      },
    },
  ]);

  for (const { publicKey: positionPda, account: position } of positions) {
    if (!position.isOpen) continue;
    if (position.market.toString() !== getMarketPda(market.index).toString()) continue;

    // Calculate margin ratio
    // Note: For a production keeper, fetch mark price from Pyth here
    // For this implementation, rely on the on-chain oracle validation in the liquidate ix
    const marginRatio = calculateMarginRatio(position);

    if (marginRatio < MAINTENANCE_MARGIN_RATIO) {
      console.log(`Liquidating position ${positionPda.toString()} margin=${marginRatio}`);
      try {
        await liquidate(program, positionPda, position, market, keeper);
        console.log(`Liquidated ${positionPda.toString()}`);
      } catch (e) {
        console.error(`Liquidation failed for ${positionPda.toString()}:`, e);
      }
    }
  }
}

function calculateMarginRatio(position: any): number {
  // Simplified: position.collateral / position.openNotional × RATIO_PRECISION
  // In production, factor in unrealized PnL by reading oracle price
  if (position.openNotional.toNumber() === 0) return 0;
  return (position.collateral.toNumber() * 1_000_000) / position.openNotional.toNumber();
}

async function liquidate(
  program: anchor.Program,
  positionPda: PublicKey,
  position: any,
  market: { index: number; oracle: PublicKey },
  keeper: Keypair
) {
  const marketPda = getMarketPda(market.index);
  const userAccountPda = position.userAccount;

  // Derive vault PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    program.programId
  );

  // Get or create keeper's USDC token account
  const keeperTokenAccount = await getOrCreateAssociatedTokenAccount(/* ... */);

  await program.methods
    .liquidatePosition()
    .accounts({
      liquidator: keeper.publicKey,
      user: position.userAccount,  // derive user from user_account
      userAccount: userAccountPda,
      position: positionPda,
      market: marketPda,
      vault: vaultPda,
      liquidatorTokenAccount: keeperTokenAccount,
      oracle: market.oracle,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([keeper])
    .rpc();
}

function getMarketPda(marketIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([marketIndex]).buffer)],
    /* PROGRAM_ID */
  );
  return pda;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 15.5 `keeper/src/funding.ts`

```typescript
export async function runFundingSettler(
  program: anchor.Program,
  connection: Connection,
  keeperKeypair: Keypair
) {
  console.log('Funding settler started');
  while (true) {
    try {
      for (const market of MARKETS) {
        await settleStalePositions(program, market, keeperKeypair);
      }
    } catch (e) {
      console.error('Funding settler error:', e);
    }
    await sleep(FUNDING_SETTLE_INTERVAL_MS);
  }
}

async function settleStalePositions(program: anchor.Program, market: any, keeper: Keypair) {
  const now = Math.floor(Date.now() / 1000);
  const positions = await program.account.position.all(/* open positions filter */);
  for (const { publicKey: positionPda, account: position } of positions) {
    if (!position.isOpen) continue;
    const staleSecs = now - position.lastFundingTs.toNumber();
    if (staleSecs > STALE_FUNDING_THRESHOLD_SECS) {
      try {
        await program.methods.settleFunding()
          .accounts({
            caller: keeper.publicKey,
            userAccount: position.userAccount,
            position: positionPda,
            market: getMarketPda(market.index),
            oracle: market.oracle,
          })
          .signers([keeper])
          .rpc();
        console.log(`Settled funding for ${positionPda.toString()}`);
      } catch (e) {
        // Ignore "FundingTooRecent" errors
        if (!e.toString().includes('FundingTooRecent')) console.error(e);
      }
    }
  }
}
```

### 15.6 `keeper/src/amm.ts`

```typescript
export async function runAmmUpdater(program: anchor.Program, connection: Connection, keeper: Keypair) {
  console.log('AMM updater started');
  while (true) {
    try {
      for (const market of MARKETS) {
        const marketPda = getMarketPda(market.index);
        const marketAccount = await program.account.market.fetch(marketPda);

        const totalOi = marketAccount.openInterestLong.add(marketAccount.openInterestShort);
        if (totalOi.isZero()) { await sleep(AMM_UPDATE_INTERVAL_MS); continue; }

        const imbalance = Math.abs(
          marketAccount.openInterestLong.toNumber() - marketAccount.openInterestShort.toNumber()
        ) / totalOi.toNumber();

        if (imbalance > 0.25) {
          console.log(`Market ${market.name} OI imbalance ${(imbalance * 100).toFixed(1)}%, updating AMM...`);
          await program.methods.updateAmm()
            .accounts({ caller: keeper.publicKey, market: marketPda, oracle: market.oracle })
            .signers([keeper])
            .rpc();
        }
      }
    } catch (e) {
      console.error('AMM updater error:', e);
    }
    await sleep(AMM_UPDATE_INTERVAL_MS);
  }
}
```

---

## 16. Frontend Specification

### 16.1 Stack

```json
{
  "framework": "Next.js 14 (App Router)",
  "styling": "Tailwind CSS + shadcn/ui",
  "wallet": "@solana/wallet-adapter-react + @solana/wallet-adapter-phantom",
  "program": "@coral-xyz/anchor ^0.31.1",
  "price": "@pythnetwork/hermes-client (WebSocket live price feed)",
  "charts": "lightweight-charts ^4.0.0",
  "deployment": "Vercel (free tier)"
}
```

### 16.2 `frontend/package.json`

```json
{
  "name": "perp-flow-frontend",
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/web3.js": "^1.98.0",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-react-ui": "^0.9.35",
    "@solana/wallet-adapter-phantom": "^0.9.24",
    "@solana/wallet-adapter-backpack": "^0.1.0",
    "@solana/spl-token": "^0.4.9",
    "@pythnetwork/hermes-client": "^1.0.0",
    "lightweight-charts": "^4.2.0",
    "tailwindcss": "^3.4.0",
    "@shadcn/ui": "latest",
    "lucide-react": "^0.383.0",
    "clsx": "^2.1.0"
  }
}
```

### 16.3 App Layout (`src/app/layout.tsx`)

Wrap entire app in:
- `WalletContextProvider` (from @solana/wallet-adapter-react)
- Configure Phantom and Backpack adapters
- Configure connection to devnet: `https://api.devnet.solana.com`

### 16.4 Main Trading Page (`src/app/page.tsx`)

Single page layout (desktop):
```
┌──────────────────────────────────────────────────────────────────┐
│ [PerpFlow logo]   SOL/USD ▼       [Deposit/Withdraw]  [Wallet]   │
├──────────────────────────────────────────────────────────────────┤
│                                         │                        │
│   MarketHeader                          │   OrderForm            │
│   Mark: $XXX.XX  Index: $XXX.XX         │   [LONG] [SHORT]       │
│   Funding: +0.042%/hr  OI: $XXXk        │   Collateral: _____    │
│                                         │   Leverage: [====] 5x  │
│   PriceChart                            │   Notional: $X,XXX     │
│   (candlestick or line chart)           │   Liq Price: $XX.XX    │
│                                         │   Fee: $X.XX           │
│                                         │   [Open Long]          │
│                                         │                        │
├──────────────────────────────────────────┤                        │
│   PositionPanel                         │                        │
│   Direction: LONG  Size: 0.5 SOL        │                        │
│   Entry: $XX.XX   Mark: $XX.XX          │                        │
│   PnL: +$XX.XX (+X.XX%)                 │                        │
│   Collateral: $XX.XX  Health: XX%       │                        │
│   [Close Position]                      │                        │
└──────────────────────────────────────────┴────────────────────────┘
```

### 16.5 `MarketHeader` Component

Polls data every 2 seconds:
- `mark_price`: from `market.mark_price()` (read market account from RPC)
- `index_price`: from Pyth Hermes WebSocket (live)
- `funding_rate_display`: `(mark - index) / index / 24 × 100` as `%/hr`
  - Positive = red (longs pay), Negative = green (longs receive)
- `open_interest_long`: from `market.open_interest_long` in UI-readable format
- `open_interest_short`: same

### 16.6 `OrderForm` Component

State:
- `direction: 'long' | 'short'`
- `collateral: string` (input, USDC amount)
- `leverage: number` (slider 1-10)

Derived (computed in real-time, no contract call):
- `notional = parseFloat(collateral) * leverage`
- `estimatedEntryPrice` (read mark price, apply slippage estimate using vAMM formula client-side)
- `liquidationPrice` = `entryPrice × (1 - 1/leverage + MAINTENANCE_MARGIN_RATIO/RATIO_PRECISION)`
  - For long: `liqPrice = entryPrice × (1 - (1/leverage - 0.0625))`
  - For short: `liqPrice = entryPrice × (1 + (1/leverage - 0.0625))`
- `fee = notional × TAKER_FEE_RATE / RATIO_PRECISION`

**On "Open Position" click:**
1. Check wallet connected
2. Check user has USDC token account
3. Call `program.methods.openPosition({ direction, collateral: toMicroUsdc(collateral), leverage })`
4. Show toast on success with tx hash

### 16.7 `PositionPanel` Component

Fetches position PDA using `[b"position", userAccountPda, marketPda]`. Subscribes to account changes.

Displays:
- Direction badge (LONG in green, SHORT in red)
- Entry price, current mark price
- Unrealized PnL (computed client-side: match direction with mark vs entry)
- Collateral, effective leverage
- Health percentage with color coding (>20% green, 10-20% yellow, <10% red)
- "Close Position" button: calls `program.methods.closePosition()`

### 16.8 `FaucetButton` Component

Calls `program.methods.mintTestUsdc()` to mint 10,000 USDC test tokens.
Show as a small button in the deposit modal: "Get 10,000 test USDC".

### 16.9 `useOraclePrice` Hook

```typescript
import { HermesClient } from '@pythnetwork/hermes-client';

const HERMES_ENDPOINT = 'https://hermes-beta.pyth.network'; // devnet Hermes
const SOL_USD_FEED_ID = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

export function useOraclePrice(feedId: string) {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    const client = new HermesClient(HERMES_ENDPOINT);
    const unsubscribe = client.subscribePriceFeedUpdates(
      [feedId],
      (update) => {
        const p = update.parsed?.[0]?.price;
        if (p) setPrice(Number(p.price) * Math.pow(10, p.expo));
      }
    );
    return () => unsubscribe();
  }, [feedId]);
  return price;
}
```

### 16.10 `utils/anchor.ts`

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import idl from '../idl/perp_dex.json';

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
export const MARKET_INDEX = 0;  // SOL/USD

export function getProgram(wallet: anchor.Wallet) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
}

// PDA derivation helpers
export function getMarketPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
    PROGRAM_ID
  );
  return pda;
}

export function getUserAccountPda(userWallet: PublicKey): PublicKey {
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_account'), userWallet.toBuffer(), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getPositionPda(userWallet: PublicKey): PublicKey {
  const userAccountPda = getUserAccountPda(userWallet);
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), userAccountPda.toBuffer(), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getVaultPda(): PublicKey {
  const marketPda = getMarketPda();
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

// Price formatting
export function formatPrice(priceRaw: anchor.BN, precision = 9): string {
  const price = priceRaw.toNumber() / Math.pow(10, precision);
  return price.toFixed(2);
}

export function toMicroUsdc(usdcAmount: number): anchor.BN {
  return new anchor.BN(Math.floor(usdcAmount * 1_000_000));
}
```

---

## 17. Environment Variables

### `frontend/.env.local`
```
NEXT_PUBLIC_PROGRAM_ID=<deployed program ID>
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_MARKET_INDEX=0
NEXT_PUBLIC_SOL_USD_ORACLE=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG
NEXT_PUBLIC_SOL_USD_FEED_ID=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
```

### `keeper/.env`
```
RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<deployed program ID>
KEEPER_KEYPAIR=[<array of secret key bytes>]
MARKET_0_ADDRESS=<market PDA>
```

---

## 18. Deployment Steps

Perform these in order after coding is complete.

```bash
# 1. Install dependencies
cd programs/perp-dex && cargo build  # Verify compiles

# 2. Install JS tooling
yarn install  # from root (covers keeper and tests)
cd frontend && npm install

# 3. Configure devnet
solana config set --url devnet
solana airdrop 5  # Get SOL for deployment

# 4. Build program
anchor build

# 5. Get program ID
anchor keys list
# Update declare_id! in programs/perp-dex/src/lib.rs with the printed ID
# Update [programs.devnet] in Anchor.toml with the same ID
# Update NEXT_PUBLIC_PROGRAM_ID in frontend/.env.local
# Rebuild: anchor build (again, to embed the correct ID)

# 6. Deploy to devnet
anchor deploy --provider.cluster devnet

# 7. Initialize mock USDC mint (run the setup script)
# Create: scripts/setup-devnet.ts
# This script:
#   a. Creates a new mint (mock USDC with 6 decimals)
#   b. Calls initialize_market with market_index=0, SOL/USD oracle, initial reserves
#   c. Saves mint address and market PDA to a config file
ts-node scripts/setup-devnet.ts

# 8. Copy IDL to frontend
cp target/idl/perp_dex.json frontend/src/idl/perp_dex.json
# Also copy to keeper/idl/

# 9. Deploy frontend
cd frontend
npm run build
# Deploy to Vercel:
npx vercel --prod
# Set environment variables in Vercel dashboard

# 10. Start keeper
cd keeper
KEEPER_KEYPAIR=$(cat ~/.config/solana/id.json) ts-node src/index.ts
```

### `scripts/setup-devnet.ts`
```typescript
import * as anchor from '@coral-xyz/anchor';
import { createMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { Connection, Keypair } from '@solana/web3.js';

const INITIAL_BASE_RESERVE = BigInt('1000000000000000'); // 1M × 10^9
const INITIAL_QUOTE_RESERVE = BigInt('100000000000000'); // 100M × 10^6 (different precision)

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = Keypair.fromSecretKey(/* load from file */);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const program = new anchor.Program(/* idl, program id, provider */);

  // 1. Create mock USDC mint
  const usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log('Mock USDC mint:', usdcMint.toString());

  // 2. Initialize market
  const ORACLE = new anchor.web3.PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG');
  const MARKET_INDEX = 0;

  const [marketPda, marketBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from(new Uint16Array([MARKET_INDEX]).buffer)],
    program.programId
  );

  const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    program.programId
  );

  await program.methods.initializeMarket({
    marketIndex: MARKET_INDEX,
    marketName: Array.from(Buffer.from('SOL-USD\0\0\0\0\0\0\0\0\0')),
    initialBaseReserve: new anchor.BN(INITIAL_BASE_RESERVE.toString()),
    initialQuoteReserve: new anchor.BN(INITIAL_QUOTE_RESERVE.toString()),
    initialMarginRatio: new anchor.BN(100_000),     // 10%
    maintenanceMarginRatio: new anchor.BN(62_500),  // 6.25%
    takerFeeRate: new anchor.BN(1_000),             // 0.1%
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
  console.log('Save these to your .env files!');
}
main().catch(console.error);
```

---

## 19. Integration Tests (`tests/perp-dex.ts`)

Test all critical paths:

```typescript
import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { PerpDex } from '../target/types/perp_dex';

describe('perp-dex', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PerpDex as anchor.Program<PerpDex>;

  let marketPda: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let userWallet: anchor.web3.Keypair;
  let userUsdcAccount: anchor.web3.PublicKey;

  before(async () => {
    userWallet = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(userWallet.publicKey, 5e9);
    // Create USDC mint, mint test tokens, etc.
  });

  it('initializes market with correct reserves', async () => {
    // Call initialize_market
    // Fetch market account
    // Assert base/quote reserves match inputs
    // Assert mark_price = quote/base
  });

  it('deposits collateral and updates user account', async () => {
    const amount = 1_000_000_000; // 1000 USDC
    // Call deposit_collateral
    const ua = await program.account.userAccount.fetch(userAccountPda);
    expect(ua.collateral.toNumber()).to.eq(amount);
  });

  it('opens a long position and updates vAMM reserves', async () => {
    // Call open_position { direction: Long, collateral: 100 USDC, leverage: 5 }
    // Fetch position, verify is_open, base_asset_amount > 0
    // Fetch market, verify quote_reserve increased, base_reserve decreased
    // Verify open_interest_long increased
  });

  it('prevents opening a second position while one is open', async () => {
    // Attempt to open position → expect PositionAlreadyOpen error
  });

  it('calculates correct unrealized PnL', async () => {
    // Open position at known price
    // Read mark price after
    // Calculate expected PnL
    // Compare with what frontend math would show
  });

  it('closes position and settles PnL to user account', async () => {
    // Call close_position
    // Fetch user_account, verify collateral increased by PnL
    // Fetch position, verify is_open = false
    // Fetch market, verify OI decreased
  });

  it('settle_funding updates cumulative rate and deducts collateral', async () => {
    // Open position
    // Advance time (localnet only) or wait on devnet
    // Call settle_funding
    // Verify position.total_funding_paid changed
  });

  it('liquidates undercollateralized position', async () => {
    // Open highly leveraged position
    // Wait for price to move (devnet) or manually set mock oracle (localnet)
    // Call liquidate_position as keeper
    // Verify position closed, liquidator received fee
  });

  it('update_amm adjusts k when OI is imbalanced', async () => {
    // Open only long positions (no shorts)
    // Call update_amm
    // Verify sqrt_k changed in the direction that makes longs more expensive
  });

  it('faucet mints test USDC', async () => {
    // Call mint_test_usdc
    // Verify token account balance increased by 10_000 USDC
  });
});
```

---

## 20. README Template

```markdown
# PerpFlow — On-Chain vAMM Perpetual Futures DEX

**Live demo:** https://perp-flow.vercel.app
**Demo video:** https://loom.com/share/<id>
**Program ID (devnet):** <PROGRAM_ID>

## What is PerpFlow?

PerpFlow is a fully on-chain perpetual futures exchange built on Solana using the Anchor framework.
Users can open leveraged long and short positions on SOL/USD using USDC as collateral.

Key technical highlights:
- **Dynamic-k vAMM**: the AMM invariant (k = x·y) adjusts based on open interest imbalance,
  disincentivising over-concentration on one side and reducing slippage for the minority side.
- **Real Pyth oracle**: index prices sourced from Pyth Network devnet feeds, not mock prices.
- **Automated keeper bot**: a TypeScript bot handles liquidations (every 400ms), funding
  settlements (every 5 min), and AMM k-updates (every 15 min).
- **Continuous funding**: funding accrues per-second and is settled lazily per-position.

## Architecture

See `SPEC.md` for the complete technical specification.

## Quick Start

### Prerequisites
- Solana CLI >= 2.0.0
- Anchor CLI 0.31.1
- Node.js >= 20.0
- Yarn

### Run locally

```bash
# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Initialize market
ts-node scripts/setup-devnet.ts

# Start keeper
cd keeper && ts-node src/index.ts

# Start frontend
cd frontend && npm run dev
```

### Get test USDC

Connect your wallet and click "Get 10,000 test USDC" in the deposit modal.

## Smart Contract

All logic is in `programs/perp-dex/src/`. Instructions:
| Instruction | Description |
|---|---|
| `initialize_market` | Admin: creates market with vAMM params |
| `deposit_collateral` | Deposit USDC as margin |
| `withdraw_collateral` | Withdraw free collateral |
| `open_position` | Open leveraged long/short |
| `close_position` | Close position, settle PnL |
| `liquidate_position` | Keeper: liquidate unhealthy position |
| `settle_funding` | Keeper: apply funding payments |
| `update_amm` | Keeper: adjust k based on OI imbalance |

## vAMM Math

The vAMM uses a constant-product invariant `k = base_reserve × quote_reserve`.
Mark price = `quote_reserve / base_reserve`.

**Dynamic-k adjustment (novel):** Every 15 minutes, the keeper computes:
```
imbalance = (long_OI - short_OI) / total_OI
k_adjustment ≈ 1 + imbalance × K_SENSITIVITY
```
Both reserves are scaled by `sqrt(k_adjustment)` to preserve mark price while shifting the invariant.
This increases slippage for the dominant side and reduces it for the minority side.

## Built with
Anchor, Solana, Pyth Network, TypeScript, Next.js, Tailwind CSS, shadcn/ui
```

---

## 21. What the Agent Must NOT Do

- Do not add a native token, governance, or DAO mechanics — out of scope.
- Do not build cross-margin (one position per user per market maximum).
- Do not use mock prices; use real Pyth devnet feeds.
- Do not use floating point in the Anchor program. Only i64/u64/u128/i128 with explicit precision scaling.
- Do not skip the keeper bot — it is required for the demo (judges want to see a live liquidation).
- Do not use the deprecated Pyth V1 oracle. Use `pyth-solana-receiver-sdk` (V2 pull oracle).
- Do not leave account constraint checks incomplete. Every PDA must have `seeds` and `bump` constraints.

---

## 22. Definition of Done

The project is complete when:

1. `anchor build` succeeds with zero warnings
2. `anchor deploy --provider.cluster devnet` succeeds
3. All 9 integration tests pass on devnet
4. `ts-node scripts/setup-devnet.ts` initializes market successfully
5. Frontend is deployed to Vercel and accessible at a public URL
6. Keeper bot runs continuously without crashing for >5 minutes
7. A user can perform the full flow on the live site:
   - Connect wallet → Get test USDC → Deposit → Open Long → Watch funding → Close
8. A keeper-triggered liquidation is visible in explorer for the demo Loom video
9. README contains live demo link, Loom video link, and clear setup instructions
10. GitHub repository is public with all code committed (no `target/` or `node_modules/`)

---

*End of specification. Build everything described above.*
