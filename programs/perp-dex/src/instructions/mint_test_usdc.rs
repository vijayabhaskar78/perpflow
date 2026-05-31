use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::error::PerpError;

pub const FAUCET_AMOUNT: u64 = 10_000 * 1_000_000; // 10,000 USDC

#[derive(Accounts)]
pub struct MintTestUsdc<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"usdc_mint"],
        bump
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ PerpError::Unauthorized,
        constraint = user_token_account.mint == usdc_mint.key() @ PerpError::OraclePriceInvalid
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: Mint authority PDA
    #[account(
        seeds = [b"mint_authority"],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn mint_test_usdc_handler(ctx: Context<MintTestUsdc>) -> Result<()> {
    let mint_authority_bump = ctx.bumps.mint_authority;
    let seeds = &[b"mint_authority".as_ref(), &[mint_authority_bump]];
    let signer = &[&seeds[..]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::mint_to(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
        FAUCET_AMOUNT,
    )?;

    Ok(())
}
