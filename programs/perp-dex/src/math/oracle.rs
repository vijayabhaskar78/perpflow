use anchor_lang::prelude::*;
use crate::error::PerpError;

pub fn validate_and_get_price<'info>(
    price_update: AccountInfo<'info>,
    feed_id_hex: &str,
    clock: &Clock,
) -> Result<u128> {
    use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

    require_keys_eq!(
        *price_update.owner,
        pyth_solana_receiver_sdk::ID,
        PerpError::OraclePriceInvalid
    );

    let data = price_update.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    let price_update_data = PriceUpdateV2::try_deserialize(&mut data_slice)?;
    let feed_id = get_feed_id_from_hex(feed_id_hex)
        .map_err(|_| error!(PerpError::OraclePriceInvalid))?;

    let price = price_update_data
        .get_price_no_older_than(clock, 5, &feed_id)
        .map_err(|_| error!(PerpError::OraclePriceStale))?;

    require!(price.price > 0, PerpError::OraclePriceInvalid);
    require!(
        price.conf < (price.price.unsigned_abs() / 20),
        PerpError::OraclePriceConfidenceTooWide
    );

    let price_scaled = if price.exponent >= 0 {
        (price.price as u128)
            .checked_mul(10u128.pow(9 + price.exponent as u32))
            .ok_or(error!(PerpError::MathOverflow))?
    } else {
        let exp = (-price.exponent) as u32;
        if exp <= 9 {
            (price.price as u128)
                .checked_mul(10u128.pow(9 - exp))
                .ok_or(error!(PerpError::MathOverflow))?
        } else {
            (price.price as u128)
                .checked_div(10u128.pow(exp - 9))
                .ok_or(error!(PerpError::DivisionByZero))?
        }
    };

    Ok(price_scaled)
}
