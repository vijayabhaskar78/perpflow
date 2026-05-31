use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Market, UserAccount};
use crate::error::PerpError;

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct WithdrawCollateral<'info> {
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
}

pub fn withdraw_collateral_handler(
    ctx: Context<WithdrawCollateral>,
    market_index: u16,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, PerpError::ZeroCollateral);
    require!(
        amount <= ctx.accounts.user_account.collateral,
        PerpError::InsufficientCollateral
    );

    let market_key = ctx.accounts.market.key();
    let vault_bump = ctx.bumps.vault;
    let seeds = &[
        b"vault".as_ref(),
        market_key.as_ref(),
        &[vault_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.market.to_account_info(),
    };

    let market_bump = ctx.accounts.market.bump;
    let market_index_bytes = market_index.to_le_bytes();
    let market_seeds = &[
        b"market".as_ref(),
        market_index_bytes.as_ref(),
        &[market_bump],
    ];
    let market_signer = &[&market_seeds[..]];

    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, market_signer),
        amount,
    )?;

    let _ = signer_seeds;

    let user_account = &mut ctx.accounts.user_account;
    user_account.collateral = user_account.collateral
        .checked_sub(amount)
        .ok_or(error!(PerpError::MathUnderflow))?;
    user_account.total_withdrawn = user_account.total_withdrawn
        .checked_add(amount)
        .ok_or(error!(PerpError::MathOverflow))?;

    Ok(())
}
