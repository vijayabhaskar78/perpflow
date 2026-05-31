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
    pub user_account: Pubkey,
    pub market: Pubkey,
    pub is_open: bool,
    pub direction: Direction,
    pub bump: u8,

    pub base_asset_amount: u128,
    pub open_notional: u64,
    pub entry_price: u128,

    pub collateral: u64,
    pub leverage: u8,

    pub last_cumulative_funding_rate: i128,

    pub open_ts: i64,
    pub last_funding_ts: i64,

    pub realized_pnl: i64,
    pub total_funding_paid: i64,

    pub _padding: [u64; 4],
}

impl Position {
    pub const LEN: usize = 256;
}
