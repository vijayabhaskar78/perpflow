use anchor_lang::prelude::*;
use crate::state::Market;
use crate::error::PerpError;
use crate::events::AmmUpdated;
use crate::math::oracle::validate_and_get_price;
use crate::math::amm::integer_sqrt;
use crate::constants::{RATIO_PRECISION, OI_IMBALANCE_THRESHOLD, K_SENSITIVITY, MAX_K_ADJUSTMENT};

#[derive(Accounts)]
pub struct UpdateAmm<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: Pyth
    #[account(constraint = oracle.key() == market.oracle @ PerpError::OraclePriceInvalid)]
    pub oracle: AccountInfo<'info>,
}

pub fn update_amm_handler(ctx: Context<UpdateAmm>) -> Result<()> {
    let clock = Clock::get()?;
    let _index_price = validate_and_get_price(
        ctx.accounts.oracle.clone(),
        "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        &clock,
    )?;

    let market = &mut ctx.accounts.market;
    let total_oi = market.open_interest_long + market.open_interest_short;
    if total_oi == 0 {
        return Ok(());
    }

    let long_ratio = (market.open_interest_long * RATIO_PRECISION as u128 / total_oi) as i64;
    let signed_imbalance = long_ratio - 500_000i64;
    let imbalance = signed_imbalance.unsigned_abs() as u64 * 2;

    if imbalance < OI_IMBALANCE_THRESHOLD {
        return Ok(());
    }

    let k_adjustment = ((signed_imbalance * K_SENSITIVITY as i64) / RATIO_PRECISION as i64)
        .clamp(-(MAX_K_ADJUSTMENT as i64), MAX_K_ADJUSTMENT as i64);

    let numerator = (RATIO_PRECISION as i64 + k_adjustment / 2) as u128;
    let old_sqrt_k = market.sqrt_k;

    market.base_asset_reserve = market.base_asset_reserve
        .checked_mul(numerator)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION as u128)
        .ok_or(error!(PerpError::DivisionByZero))?;
    market.quote_asset_reserve = market.quote_asset_reserve
        .checked_mul(numerator)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(RATIO_PRECISION as u128)
        .ok_or(error!(PerpError::DivisionByZero))?;
    market.sqrt_k = integer_sqrt(
        market.base_asset_reserve
            .saturating_mul(market.quote_asset_reserve),
    );

    emit!(AmmUpdated {
        market: market.key(),
        old_sqrt_k,
        new_sqrt_k: market.sqrt_k,
        imbalance_bps: signed_imbalance / 100,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
