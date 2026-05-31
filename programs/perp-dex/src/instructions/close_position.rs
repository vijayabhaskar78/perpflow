use anchor_lang::prelude::*;
use crate::state::{Market, UserAccount, Position};
use crate::state::position::Direction;
use crate::error::PerpError;
use crate::events::PositionClosed;
use crate::math::oracle::validate_and_get_price;
use crate::math::amm::{get_close_swap_output, integer_sqrt};
use crate::math::funding::{accumulate_funding, calculate_funding_payment};
use crate::constants::{RATIO_PRECISION, PRICE_PRECISION, AMM_RESERVE_PRECISION};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
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
        mut,
        seeds = [b"position", user_account.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        constraint = position.is_open @ PerpError::NoOpenPosition,
        constraint = position.user_account == user_account.key() @ PerpError::Unauthorized
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth price account
    #[account(constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid)]
    pub oracle: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn close_position_handler(ctx: Context<ClosePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let index_price = validate_and_get_price(
        ctx.accounts.oracle.clone(),
        "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        &clock,
    )?;

    let market = &mut ctx.accounts.market;
    let mark_price = market.mark_price()?;
    accumulate_funding(market, mark_price, index_price, clock.unix_timestamp);

    let position = &ctx.accounts.position;
    let funding_payment = calculate_funding_payment(
        market,
        position.direction,
        position.base_asset_amount,
        position.last_cumulative_funding_rate,
    );

    let k = market.base_asset_reserve
        .checked_mul(market.quote_asset_reserve)
        .ok_or(error!(PerpError::MathOverflow))?;

    let exit_notional = get_close_swap_output(
        market.base_asset_reserve,
        market.quote_asset_reserve,
        k,
        position.direction,
        position.base_asset_amount,
        position.open_notional,
    )?;

    let pnl = match position.direction {
        Direction::Long => exit_notional as i64 - position.open_notional as i64,
        Direction::Short => position.open_notional as i64 - exit_notional as i64,
    };

    let exit_fee = exit_notional
        .checked_mul(market.taker_fee_rate)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;

    let position_collateral = position.collateral;
    let open_notional = position.open_notional;
    let base_asset_amount = position.base_asset_amount;
    let direction = position.direction;
    let entry_price = position.entry_price;

    let returned = position_collateral as i64 + pnl - exit_fee as i64 - funding_payment;
    let user_account = &mut ctx.accounts.user_account;
    if returned > 0 {
        user_account.collateral = user_account.collateral
            .saturating_add(returned as u64);
    }

    match direction {
        Direction::Long => {
            market.open_interest_long = market.open_interest_long
                .saturating_sub(base_asset_amount);
            let new_base = market.base_asset_reserve
                .checked_add(base_asset_amount)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_quote = k
                .checked_div(new_base)
                .ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
        }
        Direction::Short => {
            market.open_interest_short = market.open_interest_short
                .saturating_sub(base_asset_amount);
            let new_quote = market.quote_asset_reserve
                .checked_add(open_notional as u128)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_base = k
                .checked_div(new_quote)
                .ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
        }
    }

    market.sqrt_k = integer_sqrt(
        market.base_asset_reserve
            .saturating_mul(market.quote_asset_reserve),
    );
    market.total_positions = market.total_positions.saturating_sub(1);

    let exit_price = (exit_notional as u128)
        .checked_mul(PRICE_PRECISION)
        .unwrap_or(entry_price * exit_notional as u128)
        .checked_div(base_asset_amount.max(1))
        .unwrap_or(entry_price);

    let _ = (RATIO_PRECISION, AMM_RESERVE_PRECISION);

    let position = &mut ctx.accounts.position;
    position.is_open = false;
    position.realized_pnl = position.realized_pnl.saturating_add(pnl);
    position.total_funding_paid = position.total_funding_paid.saturating_add(funding_payment);

    emit!(PositionClosed {
        market: market.key(),
        user: ctx.accounts.user.key(),
        direction,
        realized_pnl: pnl,
        exit_price,
        fee: exit_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
