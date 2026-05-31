use anchor_lang::prelude::*;

#[error_code]
pub enum PerpError {
    #[msg("Unauthorized: caller is not the market authority")]
    Unauthorized,

    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Market not initialized")]
    MarketNotInitialized,

    #[msg("Math overflow in vAMM calculation")]
    MathOverflow,
    #[msg("Math underflow in vAMM calculation")]
    MathUnderflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Square root of zero is not defined in this context")]
    SqrtOfZero,

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

    #[msg("Insufficient collateral: amount requested exceeds free collateral")]
    InsufficientCollateral,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,

    #[msg("Position is healthy; cannot liquidate")]
    PositionHealthy,
    #[msg("Position is bankrupt; insurance fund covers remaining debt")]
    PositionBankrupt,

    #[msg("Pyth oracle price is stale (>5 seconds old)")]
    OraclePriceStale,
    #[msg("Pyth oracle price confidence interval too wide")]
    OraclePriceConfidenceTooWide,
    #[msg("Pyth oracle price is negative or zero")]
    OraclePriceInvalid,

    #[msg("AMM reserves would become negative; trade size too large")]
    AmmReservesInvalid,
    #[msg("vAMM invariant (k) would change more than MAX_K_ADJUSTMENT")]
    KAdjustmentTooLarge,

    #[msg("Funding already settled recently; too soon to re-settle")]
    FundingTooRecent,
}
