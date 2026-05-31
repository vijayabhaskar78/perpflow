use anchor_lang::prelude::*;
use crate::error::PerpError;
use crate::constants::PRICE_PRECISION;

#[account]
#[derive(Default)]
pub struct Market {
    pub authority: Pubkey,
    pub market_index: u16,
    pub market_name: [u8; 16],
    pub quote_mint: Pubkey,
    pub oracle: Pubkey,
    pub vault: Pubkey,
    pub is_active: bool,
    pub bump: u8,

    pub base_asset_reserve: u128,
    pub quote_asset_reserve: u128,
    pub sqrt_k: u128,

    pub open_interest_long: u128,
    pub open_interest_short: u128,
    pub total_positions: u64,

    pub cumulative_funding_rate_long: i128,
    pub cumulative_funding_rate_short: i128,
    pub last_funding_ts: i64,
    pub last_mark_price_twap: u128,
    pub last_mark_price_twap_ts: i64,

    pub total_fee_collected: u64,
    pub total_fee_minus_distributions: i64,
    pub insurance_fund_balance: u64,

    pub initial_margin_ratio: u64,
    pub maintenance_margin_ratio: u64,
    pub taker_fee_rate: u64,
    pub max_leverage: u8,

    pub _padding: [u64; 8],
}

impl Market {
    pub const LEN: usize = 512;

    pub fn mark_price(&self) -> Result<u128> {
        self.quote_asset_reserve
            .checked_mul(PRICE_PRECISION)
            .ok_or(error!(PerpError::MathOverflow))?
            .checked_div(self.base_asset_reserve)
            .ok_or(error!(PerpError::DivisionByZero))
    }

    pub fn k(&self) -> u128 {
        self.base_asset_reserve
            .saturating_mul(self.quote_asset_reserve)
    }
}
