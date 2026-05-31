use anchor_lang::prelude::*;
use crate::state::{Market, UserAccount, Position};
use crate::error::PerpError;
use crate::events::FundingSettled;
use crate::math::oracle::validate_and_get_price;
use crate::math::funding::{accumulate_funding, calculate_funding_payment, calculate_funding_rate};
use crate::constants::STALE_FUNDING_THRESHOLD_SECS;

#[derive(Accounts)]
pub struct SettleFunding<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        constraint = position.is_open @ PerpError::NoOpenPosition,
        constraint = position.user_account == user_account.key() @ PerpError::Unauthorized
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Pyth
    #[account(constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid)]
    pub oracle: AccountInfo<'info>,
}

pub fn settle_funding_handler(ctx: Context<SettleFunding>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let stale_seconds = now - ctx.accounts.position.last_funding_ts;
    if stale_seconds <= STALE_FUNDING_THRESHOLD_SECS {
        return Ok(());
    }

    let index_price = validate_and_get_price(
        ctx.accounts.oracle.clone(),
        "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        &clock,
    )?;

    let market = &mut ctx.accounts.market;
    let mark_price = market.mark_price()?;
    let funding_rate = calculate_funding_rate(mark_price, index_price);
    accumulate_funding(market, mark_price, index_price, now);

    let position = &ctx.accounts.position;
    let funding_payment = calculate_funding_payment(
        market,
        position.direction,
        position.base_asset_amount,
        position.last_cumulative_funding_rate,
    );

    let last_cum_rate = match position.direction {
        crate::state::position::Direction::Long => market.cumulative_funding_rate_long,
        crate::state::position::Direction::Short => market.cumulative_funding_rate_short,
    };

    let user_account = &mut ctx.accounts.user_account;
    let position = &mut ctx.accounts.position;

    if funding_payment > 0 {
        position.collateral = position.collateral.saturating_sub(funding_payment as u64);
        user_account.collateral = user_account.collateral.saturating_sub(funding_payment as u64);
    } else {
        let received = (-funding_payment) as u64;
        position.collateral = position.collateral.saturating_add(received);
        user_account.collateral = user_account.collateral.saturating_add(received);
    }

    position.last_cumulative_funding_rate = last_cum_rate;
    position.last_funding_ts = now;
    position.total_funding_paid = position.total_funding_paid.saturating_add(funding_payment);

    emit!(FundingSettled {
        market: ctx.accounts.market.key(),
        user: user_account.authority,
        funding_payment,
        funding_rate,
        timestamp: now,
    });

    Ok(())
}
