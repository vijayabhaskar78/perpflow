use anchor_lang::prelude::*;
use crate::error::PerpError;
use crate::constants::RATIO_PRECISION;
use crate::state::position::{Direction, Position};
use crate::state::market::Market;
use super::amm::get_close_swap_output;

pub fn calculate_unrealized_pnl(
    position: &Position,
    market: &Market,
) -> Result<i64> {
    if !position.is_open || position.base_asset_amount == 0 {
        return Ok(0);
    }

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

    Ok(pnl)
}

pub fn calculate_health(
    collateral: u64,
    unrealized_pnl: i64,
    open_notional: u64,
) -> u64 {
    let effective_collateral = collateral as i64 + unrealized_pnl;
    if effective_collateral <= 0 || open_notional == 0 {
        return 0;
    }
    (effective_collateral as u128 * RATIO_PRECISION as u128 / open_notional as u128) as u64
}
