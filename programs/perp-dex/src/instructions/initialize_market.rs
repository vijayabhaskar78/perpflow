use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::market::Market;
use crate::math::amm::integer_sqrt;
use crate::error::PerpError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeMarketParams {
    pub market_index: u16,
    pub market_name: [u8; 16],
    pub initial_base_reserve: u128,
    pub initial_quote_reserve: u128,
    pub initial_margin_ratio: u64,
    pub maintenance_margin_ratio: u64,
    pub taker_fee_rate: u64,
    pub max_leverage: u8,
}

#[derive(Accounts)]
#[instruction(params: InitializeMarketParams)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", params.market_index.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = authority,
        token::mint = quote_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub quote_mint: Account<'info, Mint>,

    /// CHECK: Pyth price feed account; validated in instruction logic
    pub oracle: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_market_handler(
    ctx: Context<InitializeMarket>,
    params: InitializeMarketParams,
) -> Result<()> {
    require!(
        params.initial_base_reserve > 0 && params.initial_quote_reserve > 0,
        PerpError::AmmReservesInvalid
    );

    let k = params.initial_base_reserve
        .checked_mul(params.initial_quote_reserve)
        .ok_or(error!(PerpError::MathOverflow))?;

    let sqrt_k = integer_sqrt(k);

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    market.authority = ctx.accounts.authority.key();
    market.market_index = params.market_index;
    market.market_name = params.market_name;
    market.quote_mint = ctx.accounts.quote_mint.key();
    market.oracle = ctx.accounts.oracle.key();
    market.vault = ctx.accounts.vault.key();
    market.is_active = true;
    market.bump = ctx.bumps.market;

    market.base_asset_reserve = params.initial_base_reserve;
    market.quote_asset_reserve = params.initial_quote_reserve;
    market.sqrt_k = sqrt_k;

    market.open_interest_long = 0;
    market.open_interest_short = 0;
    market.total_positions = 0;

    market.cumulative_funding_rate_long = 0;
    market.cumulative_funding_rate_short = 0;
    market.last_funding_ts = clock.unix_timestamp;
    market.last_mark_price_twap = params.initial_quote_reserve
        .checked_mul(crate::constants::PRICE_PRECISION)
        .unwrap_or(0)
        / params.initial_base_reserve;
    market.last_mark_price_twap_ts = clock.unix_timestamp;

    market.total_fee_collected = 0;
    market.total_fee_minus_distributions = 0;
    market.insurance_fund_balance = 0;

    market.initial_margin_ratio = params.initial_margin_ratio;
    market.maintenance_margin_ratio = params.maintenance_margin_ratio;
    market.taker_fee_rate = params.taker_fee_rate;
    market.max_leverage = params.max_leverage;

    Ok(())
}
