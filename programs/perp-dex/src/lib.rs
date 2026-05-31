#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod math;

use instructions::*;

declare_id!("7Ly59fzmJRyAk3KEHijsScahSrDtqFH1mjtTAqSZRWcH");

#[program]
pub mod perp_dex {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> Result<()> {
        initialize_market_handler(ctx, params)
    }

    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        deposit_collateral_handler(ctx, market_index, amount)
    }

    pub fn withdraw_collateral(
        ctx: Context<WithdrawCollateral>,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        withdraw_collateral_handler(ctx, market_index, amount)
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        params: OpenPositionParams,
    ) -> Result<()> {
        open_position_handler(ctx, params)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        close_position_handler(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        liquidate_position_handler(ctx)
    }

    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        settle_funding_handler(ctx)
    }

    pub fn update_amm(ctx: Context<UpdateAmm>) -> Result<()> {
        update_amm_handler(ctx)
    }

    pub fn mint_test_usdc(ctx: Context<MintTestUsdc>) -> Result<()> {
        mint_test_usdc_handler(ctx)
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>) -> Result<()> {
        update_oracle_handler(ctx)
    }
}
