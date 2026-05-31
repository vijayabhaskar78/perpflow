# PerpFlow - On-Chain vAMM Perpetual Futures DEX

PerpFlow is a Solana devnet perpetual futures demo built with Anchor. Users can connect a wallet, mint test USDC, deposit collateral, open leveraged SOL/USD long or short positions, and close positions through a Next.js frontend. A TypeScript keeper watches the market for funding settlement, AMM updates, and liquidations.

Live demo: https://perpflow-eta.vercel.app

## Status

- Anchor program builds locally.
- Keeper builds locally.
- Frontend builds locally.
- Anchor program is deployed on devnet.
- Devnet market and mock USDC are initialized.
- Frontend is deployed on Vercel.
- Keeper can be deployed as a Render background worker using `render.yaml`.

## Project Structure

| Path | Purpose |
| --- | --- |
| `programs/perp-dex` | Anchor smart contract |
| `keeper` | TypeScript maintenance bot |
| `frontend` | Next.js trading UI |
| `scripts/setup-devnet.ts` | Devnet market and mock USDC setup |
| `tests/perp-dex.ts` | Anchor integration tests |

## Prerequisites

- Node.js 20+
- Solana CLI / Agave CLI
- Anchor CLI 0.32.1
- A funded devnet keypair at `deployer-keypair-2.json`

## Build

```powershell
$env:PATH="$env:USERPROFILE\.local\solana\solana-release\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
Copy-Item "$env:USERPROFILE\.avm\bin\anchor-0.32.1" ".\anchor-0.32.1.exe" -Force
.\anchor-0.32.1.exe build
Remove-Item ".\anchor-0.32.1.exe" -Force

cd keeper
npm.cmd run build

cd ..\frontend
npm.cmd run build
```

## Devnet Deployment

Fund the deployer:

```powershell
solana-keygen pubkey .\deployer-keypair-2.json
solana airdrop 2 --url https://api.devnet.solana.com --keypair .\deployer-keypair-2.json
```

Deploy and initialize:

```powershell
$env:PATH="$env:USERPROFILE\.local\solana\solana-release\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
Copy-Item "$env:USERPROFILE\.avm\bin\anchor-0.32.1" ".\anchor-0.32.1.exe" -Force
.\anchor-0.32.1.exe deploy --provider.cluster devnet --provider.wallet .\deployer-keypair-2.json
Remove-Item ".\anchor-0.32.1.exe" -Force

npx ts-node scripts/setup-devnet.ts
Copy-Item target\idl\perp_dex.json frontend\src\idl\perp_dex.json -Force
Copy-Item target\idl\perp_dex.json keeper\idl\perp_dex.json -Force
```

## Run

```powershell
cd frontend
npm.cmd run dev
```

```powershell
cd keeper
npm.cmd run dev
```

## Hosted Keeper

The keeper must run continuously for automated liquidations, funding settlement, and AMM updates. Vercel hosts only the frontend, so the keeper should be deployed as a background worker.

This repository includes `render.yaml` for Render.

Required Render secret:

```text
KEEPER_KEYPAIR=<JSON array secret key for a funded devnet keeper wallet>
```

Use a dedicated keeper wallet instead of the program upgrade-authority wallet for public demos.

## Program

Current program ID:

```text
7Ly59fzmJRyAk3KEHijsScahSrDtqFH1mjtTAqSZRWcH
```

Devnet market:

```text
Market PDA: 9PuGd7iP3Tk46UZTYRy7DAkZoZPzxBQkowvQjyZPTon2
Mock USDC mint: GjkDy8sUU1urjekN8m5dDZ7pLqxYnqLr6yP85GkQzS4C
Vault PDA: 439iwC4SS8tqKa3WDmecmTCnFZMf4NVetQJfYqt4Yibk
SOL/USD oracle: 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE
```

The frontend and keeper env files are configured for devnet and this program ID.
