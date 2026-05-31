use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct UserAccount {
    pub authority: Pubkey,
    pub market: Pubkey,
    pub collateral: u64,
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
    pub _padding: [u64; 4],
}

impl UserAccount {
    pub const LEN: usize = 192;
}
