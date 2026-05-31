use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Market, UserAccount};
use crate::events::CollateralDeposited;
use crate::error::PerpError;

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserAccount::LEN,
        seeds = [b"user_account", user.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub user_account: Box<Account<'info, UserAccount>>,

    #[account(
        mut,
        seeds = [b"market", market_index.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ PerpError::Unauthorized,
        constraint = user_token_account.mint == market.quote_mint @ PerpError::OraclePriceInvalid
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn deposit_collateral_handler(
    ctx: Context<DepositCollateral>,
    _market_index: u16,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, PerpError::ZeroCollateral);

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

    let user_account = &mut ctx.accounts.user_account;

    if user_account.authority == Pubkey::default() {
        user_account.authority = ctx.accounts.user.key();
        user_account.market = ctx.accounts.market.key();
        user_account.bump = ctx.bumps.user_account;
    }

    user_account.collateral = user_account.collateral
        .checked_add(amount)
        .ok_or(error!(PerpError::MathOverflow))?;
    user_account.total_deposited = user_account.total_deposited
        .checked_add(amount)
        .ok_or(error!(PerpError::MathOverflow))?;

    emit!(CollateralDeposited {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        amount,
    });

    Ok(())
}
