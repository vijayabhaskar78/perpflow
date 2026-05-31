use anchor_lang::prelude::*;
use crate::error::PerpError;
use crate::constants::{AMM_RESERVE_PRECISION, PRICE_PRECISION};
use crate::state::position::Direction;

pub fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

pub fn calculate_long_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    quote_in: u128,
) -> Result<(u128, u128, u128)> {
    let new_quote = quote_reserve
        .checked_add(quote_in)
        .ok_or(error!(PerpError::MathOverflow))?;
    let new_base = k
        .checked_div(new_quote)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let base_out = base_reserve
        .checked_sub(new_base)
        .ok_or(error!(PerpError::AmmReservesInvalid))?;
    Ok((base_out, new_base, new_quote))
}

pub fn calculate_short_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    quote_notional: u128,
    mark_price: u128,
) -> Result<(u128, u128, u128)> {
    let base_in = quote_notional
        .checked_mul(AMM_RESERVE_PRECISION)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(mark_price)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let new_base = base_reserve
        .checked_add(base_in)
        .ok_or(error!(PerpError::MathOverflow))?;
    let new_quote = k
        .checked_div(new_base)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let _quote_out = quote_reserve
        .checked_sub(new_quote)
        .ok_or(error!(PerpError::AmmReservesInvalid))?;
    Ok((base_in, new_base, new_quote))
}

pub fn calculate_close_long_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    base_amount: u128,
) -> Result<(u128, u128, u128)> {
    let new_base = base_reserve
        .checked_add(base_amount)
        .ok_or(error!(PerpError::MathOverflow))?;
    let new_quote = k
        .checked_div(new_base)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let quote_out = quote_reserve
        .checked_sub(new_quote)
        .ok_or(error!(PerpError::AmmReservesInvalid))?;
    Ok((quote_out, new_base, new_quote))
}

pub fn calculate_close_short_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    base_amount: u128,
    open_notional: u64,
) -> Result<(u128, u128, u128)> {
    let _ = open_notional;
    let new_quote = quote_reserve
        .checked_add(open_notional as u128)
        .ok_or(error!(PerpError::MathOverflow))?;
    let new_base = k
        .checked_div(new_quote)
        .ok_or(error!(PerpError::DivisionByZero))?;
    let base_returned = base_reserve
        .checked_sub(new_base)
        .ok_or(error!(PerpError::AmmReservesInvalid))?;
    let _ = base_amount;
    let exit_notional = base_returned
        .checked_mul(PRICE_PRECISION)
        .ok_or(error!(PerpError::MathOverflow))?
        .checked_div(AMM_RESERVE_PRECISION)
        .ok_or(error!(PerpError::DivisionByZero))?;
    Ok((exit_notional, new_base, new_quote))
}

pub fn get_swap_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    direction: Direction,
    quote_notional: u128,
    mark_price: u128,
) -> Result<u128> {
    match direction {
        Direction::Long => {
            let (base_out, _, _) = calculate_long_output(base_reserve, quote_reserve, k, quote_notional)?;
            Ok(base_out)
        }
        Direction::Short => {
            let (base_in, _, _) = calculate_short_output(base_reserve, quote_reserve, k, quote_notional, mark_price)?;
            Ok(base_in)
        }
    }
}

pub fn get_close_swap_output(
    base_reserve: u128,
    quote_reserve: u128,
    k: u128,
    direction: Direction,
    base_asset_amount: u128,
    open_notional: u64,
) -> Result<u64> {
    match direction {
        Direction::Long => {
            let (quote_out, _, _) = calculate_close_long_output(base_reserve, quote_reserve, k, base_asset_amount)?;
            Ok(quote_out as u64)
        }
        Direction::Short => {
            let (exit_notional, _, _) = calculate_close_short_output(base_reserve, quote_reserve, k, base_asset_amount, open_notional)?;
            Ok(exit_notional as u64)
        }
    }
}
