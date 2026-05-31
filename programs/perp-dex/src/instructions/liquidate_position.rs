use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Market, UserAccount, Position};
use crate::state::position::Direction;
use crate::error::PerpError;
use crate::events::PositionLiquidated;
use crate::math::oracle::validate_and_get_price;
use crate::math::amm::{get_close_swap_output, integer_sqrt};
use crate::math::funding::{accumulate_funding, calculate_funding_payment};
use crate::math::pnl::calculate_health;
use crate::constants::{RATIO_PRECISION, LIQUIDATION_FEE_RATIO, INSURANCE_FEE_RATIO};

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

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
        constraint = position.is_open @ PerpError::NoOpenPosition
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key() @ PerpError::Unauthorized
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Pyth
    #[account(constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid)]
    pub oracle: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn liquidate_position_handler(ctx: Context<LiquidatePosition>) -> Result<()> {
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

    let effective_collateral = position.collateral as i64 - funding_payment;
    let effective_collateral = effective_collateral.max(0) as u64;

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

    let unrealized_pnl = pnl;
    let health = calculate_health(effective_collateral, unrealized_pnl, position.open_notional);
    require!(
        health < market.maintenance_margin_ratio,
        PerpError::PositionHealthy
    );

    let remaining_i64 = effective_collateral as i64 + pnl;
    let remaining = if remaining_i64 < 0 {
        let deficit = (-remaining_i64) as u64;
        market.insurance_fund_balance = market.insurance_fund_balance.saturating_sub(deficit);
        0u64
    } else {
        remaining_i64 as u64
    };

    let liquidator_fee = remaining
        .checked_mul(LIQUIDATION_FEE_RATIO)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let insurance_fee = remaining
        .checked_mul(INSURANCE_FEE_RATIO)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let user_return = remaining.saturating_sub(liquidator_fee).saturating_sub(insurance_fee);

    let base_asset_amount = position.base_asset_amount;
    let direction = position.direction;
    let open_notional = position.open_notional;

    match direction {
        Direction::Long => {
            market.open_interest_long = market.open_interest_long.saturating_sub(base_asset_amount);
            let new_base = market.base_asset_reserve
                .checked_add(base_asset_amount)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_quote = k.checked_div(new_base).ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
        }
        Direction::Short => {
            market.open_interest_short = market.open_interest_short.saturating_sub(base_asset_amount);
            let new_quote = market.quote_asset_reserve
                .checked_add(open_notional as u128)
                .ok_or(error!(PerpError::MathOverflow))?;
            let new_base = k.checked_div(new_quote).ok_or(error!(PerpError::DivisionByZero))?;
            market.base_asset_reserve = new_base;
            market.quote_asset_reserve = new_quote;
        }
    }

    market.sqrt_k = integer_sqrt(
        market.base_asset_reserve.saturating_mul(market.quote_asset_reserve),
    );
    market.total_positions = market.total_positions.saturating_sub(1);
    market.insurance_fund_balance = market.insurance_fund_balance.saturating_add(insurance_fee);

    if liquidator_fee > 0 {
        let market_key = ctx.accounts.market.key();
        let market_bump = ctx.accounts.market.bump;
        let market_index_bytes = ctx.accounts.market.market_index.to_le_bytes();
        let market_seeds = &[
            b"market".as_ref(),
            market_index_bytes.as_ref(),
            &[market_bump],
        ];
        let signer = &[&market_seeds[..]];
        let _ = market_key;

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.liquidator_token_account.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            ),
            liquidator_fee,
        )?;
    }

    ctx.accounts.user_account.collateral = ctx.accounts.user_account.collateral
        .saturating_add(user_return);

    let position = &mut ctx.accounts.position;
    position.is_open = false;
    position.realized_pnl = position.realized_pnl.saturating_add(pnl);
    position.total_funding_paid = position.total_funding_paid.saturating_add(funding_payment);

    emit!(PositionLiquidated {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        liquidator: ctx.accounts.liquidator.key(),
        realized_pnl: pnl,
        remaining_collateral: remaining,
        liquidator_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
