use anchor_lang::prelude::*;
use crate::state::{Market, UserAccount, Position};
use crate::state::position::Direction;
use crate::error::PerpError;
use crate::events::PositionOpened;
use crate::math::oracle::validate_and_get_price;
use crate::math::amm::{get_swap_output, integer_sqrt};
use crate::constants::{RATIO_PRECISION, INSURANCE_FUND_SHARE, MIN_NOTIONAL};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct OpenPositionParams {
    pub direction: Direction,
    pub collateral: u64,
    pub leverage: u8,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.authority == user.key() @ PerpError::Unauthorized
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
        constraint = market.is_active @ PerpError::MarketPaused
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth price account, validated in instruction
    #[account(constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid)]
    pub oracle: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn open_position_handler(
    ctx: Context<OpenPosition>,
    params: OpenPositionParams,
) -> Result<()> {
    require!(params.collateral > 0, PerpError::ZeroCollateral);
    require!(
        params.leverage >= 1 && params.leverage <= ctx.accounts.market.max_leverage,
        PerpError::LeverageExceeded
    );
    require!(!ctx.accounts.position.is_open, PerpError::PositionAlreadyOpen);
    require!(
        ctx.accounts.user_account.collateral >= params.collateral,
        PerpError::InsufficientCollateral
    );

    let clock = Clock::get()?;
    let feed_id_hex = get_feed_id_for_market(&ctx.accounts.market);
    let _index_price = validate_and_get_price(
        ctx.accounts.oracle.clone(),
        feed_id_hex,
        &clock,
    )?;

    let notional = (params.collateral as u64)
        .checked_mul(params.leverage as u64)
        .ok_or(error!(PerpError::MathOverflow))?;
    require!(notional >= MIN_NOTIONAL, PerpError::OrderTooSmall);

    let market = &ctx.accounts.market;
    let mark_price = market.mark_price()?;
    let k = market.base_asset_reserve
        .checked_mul(market.quote_asset_reserve)
        .ok_or(error!(PerpError::MathOverflow))?;

    let base_amount = get_swap_output(
        market.base_asset_reserve,
        market.quote_asset_reserve,
        k,
        params.direction,
        notional as u128,
        mark_price,
    )?;
    require!(base_amount > 0, PerpError::AmmReservesInvalid);

    let entry_price = (notional as u128)
        .checked_mul(crate::constants::PRICE_PRECISION)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(base_amount)
        .ok_or(error!(PerpError::DivisionByZero))?;

    let fee = notional
        .checked_mul(market.taker_fee_rate)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let insurance_portion = fee
        .checked_mul(INSURANCE_FUND_SHARE)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;

    let user_account = &mut ctx.accounts.user_account;
    require!(
        user_account.collateral >= params.collateral + fee,
        PerpError::InsufficientCollateral
    );
    user_account.collateral = user_account.collateral
        .checked_sub(fee)
        .ok_or(error!(PerpError::MathUnderflow))?;
    user_account.collateral = user_account.collateral
        .checked_sub(params.collateral)
        .ok_or(error!(PerpError::MathUnderflow))?;

    let market = &mut ctx.accounts.market;
    market.insurance_fund_balance = market.insurance_fund_balance
        .saturating_add(insurance_portion);
    market.total_fee_collected = market.total_fee_collected
        .saturating_add(fee);

    match params.direction {
        Direction::Long => {
            let new_quote = market.quote_asset_reserve
                .checked_add(notional as u128)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_base = k
                .checked_div(new_quote)
                .ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
            market.open_interest_long = market.open_interest_long
                .checked_add(base_amount)
                .ok_or(error!(PerpError::MathOverflow))?;
        }
        Direction::Short => {
            let mark_price = market.mark_price()?;
            let base_in = (notional as u128)
                .checked_mul(crate::constants::AMM_RESERVE_PRECISION)
                .ok_or(error!(PerpError::MathOverflow))?
                .checked_div(mark_price)
                .ok_or(error!(PerpError::DivisionByZero))?;
            let new_base = market.base_asset_reserve
                .checked_add(base_in)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_quote = k
                .checked_div(new_base)
                .ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
            market.open_interest_short = market.open_interest_short
                .checked_add(base_amount)
                .ok_or(error!(PerpError::MathOverflow))?;
        }
    }

    market.sqrt_k = integer_sqrt(
        market.base_asset_reserve
            .checked_mul(market.quote_asset_reserve)
            .unwrap_or(market.sqrt_k * market.sqrt_k),
    );
    market.total_positions = market.total_positions
        .checked_add(1)
        .ok_or(error!(PerpError::MathOverflow))?;

    let last_cum_rate = match params.direction {
        Direction::Long => market.cumulative_funding_rate_long,
        Direction::Short => market.cumulative_funding_rate_short,
    };

    let position = &mut ctx.accounts.position;
    position.user_account = ctx.accounts.user_account.key();
    position.market = market.key();
    position.is_open = true;
    position.direction = params.direction;
    position.base_asset_amount = base_amount;
    position.open_notional = notional;
    position.entry_price = entry_price;
    position.collateral = params.collateral;
    position.leverage = params.leverage;
    position.last_cumulative_funding_rate = last_cum_rate;
    position.open_ts = clock.unix_timestamp;
    position.last_funding_ts = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        market: market.key(),
        user: ctx.accounts.user.key(),
        direction: params.direction,
        base_asset_amount: base_amount,
        open_notional: notional,
        entry_price,
        collateral: params.collateral,
        leverage: params.leverage,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

fn get_feed_id_for_market(_market: &Market) -> &'static str {
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
}
