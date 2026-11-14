# Verity — Polygon Amoy blockchain setup

Verity uses a hybrid architecture: PostgreSQL/Supabase stores certificate details and personal information off-chain; Polygon stores only a certificate identifier fingerprint, SHA-256 digest, issuer address, issue time and revocation state.

## Network
- Network: Polygon Amoy Testnet
- Chain ID: 80002
- Native gas token: test POL
- Explorer: https://amoy.polygonscan.com
- RPC default: https://rpc-amoy.polygon.technology

## 1. Prepare a project wallet
Create a dedicated wallet for the Verity prototype. Keep its recovery phrase and private key private. Never commit either to GitHub or send it in chat. Fund the wallet with test POL from a Polygon Amoy faucet.

The wallet that deploys the contract becomes the contract owner and the first authorized issuer. The backend uses this same wallet to issue and revoke certificates.

## 2. Deploy the contract
Set these environment variables on your own trusted development machine (not in a committed file):
- CHAIN_RPC_URL=https://rpc-amoy.polygon.technology
- CHAIN_PRIVATE_KEY=your dedicated project wallet private key

Then run:
```bash
npm install
npx hardhat compile
npx hardhat run scripts/deploy.js --network amoy
```

Copy the printed contract address. The deploy script refuses to deploy unless the selected network is Polygon Amoy (80002).

## 3. Configure Render
In the Verity web service environment settings, add:
- CHAIN_RPC_URL — Polygon Amoy RPC endpoint
- CHAIN_PRIVATE_KEY — dedicated project wallet private key (secret)
- CONTRACT_ADDRESS — address printed by the deployment script
- CHAIN_ID — 80002

Render will redeploy the service. The health endpoint `/api/health` reports whether the chain is connected and the contract address. Do not share private keys or recovery phrases.

## Data protection
Do not put student names, matriculation numbers, email addresses, grades or certificate documents on-chain. Verity hashes the canonical certificate record and stores only its fingerprint on Polygon. The full record remains in Supabase.

## Prototype warning
Polygon Amoy is a public test network. Test POL has no real monetary value. This setup is for academic demonstration and testing, not production issuance on Polygon mainnet.
