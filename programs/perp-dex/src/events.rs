use anchor_lang::prelude::*;
use crate::state::position::Direction;

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
    pub imbalance_bps: i64,
    pub timestamp: i64,
}

#[event]
pub struct CollateralDeposited {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}
