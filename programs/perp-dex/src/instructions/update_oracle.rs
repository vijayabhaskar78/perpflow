use anchor_lang::prelude::*;
use crate::error::PerpError;
use crate::state::Market;

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.market_index.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.authority == authority.key() @ PerpError::Unauthorized
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth price update/feed account, validated by trading instructions
    pub oracle: UncheckedAccount<'info>,
}

pub fn update_oracle_handler(ctx: Context<UpdateOracle>) -> Result<()> {
    ctx.accounts.market.oracle = ctx.accounts.oracle.key();
    Ok(())
}
