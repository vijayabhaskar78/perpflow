use crate::constants::{MAX_FUNDING_RATE, FUNDING_PERIOD_SECS, FUNDING_PRECISION};
use crate::state::market::Market;
use crate::state::position::Direction;

pub fn calculate_funding_rate(mark_price: u128, index_price: u128) -> i64 {
    if index_price == 0 {
        return 0;
    }
    let raw_rate = (mark_price as i128 - index_price as i128)
        * FUNDING_PRECISION as i128
        / (index_price as i128 * 24);

    raw_rate.clamp(-(MAX_FUNDING_RATE as i128), MAX_FUNDING_RATE as i128) as i64
}

pub fn accumulate_funding(market: &mut Market, mark_price: u128, index_price: u128, now: i64) {
    let time_elapsed = now - market.last_funding_ts;
    if time_elapsed <= 0 {
        return;
    }

    let periods = time_elapsed as i128 * FUNDING_PRECISION as i128 / FUNDING_PERIOD_SECS as i128;
    let rate_per_period = calculate_funding_rate(mark_price, index_price) as i128;
    let rate_accumulated = rate_per_period * periods / FUNDING_PRECISION as i128;

    market.cumulative_funding_rate_long = market
        .cumulative_funding_rate_long
        .saturating_add(rate_accumulated);
    market.cumulative_funding_rate_short = market
        .cumulative_funding_rate_short
        .saturating_sub(rate_accumulated);
    market.last_funding_ts = now;
}

pub fn calculate_funding_payment(
    market: &Market,
    direction: Direction,
    base_asset_amount: u128,
    last_cumulative_funding_rate: i128,
) -> i64 {
    let cumulative_rate = match direction {
        Direction::Long => market.cumulative_funding_rate_long,
        Direction::Short => market.cumulative_funding_rate_short,
    };
    let rate_delta = cumulative_rate - last_cumulative_funding_rate;
    (base_asset_amount as i128 * rate_delta / FUNDING_PRECISION as i128) as i64
}
