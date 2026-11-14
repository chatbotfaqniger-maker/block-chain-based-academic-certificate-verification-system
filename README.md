# Verity — Blockchain-Based Academic Certificate Verification

A Docker-first academic credential issuance and verification prototype.

## Supabase setup

Verity now uses Supabase Auth and the Supabase Data API. It does **not** need a PostgreSQL connection string, database password, Prisma setup, Supabase secret key, or service-role key.

Configure only:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The database migration creates the Auth-to-profile trigger, access policies, and a restricted public certificate lookup function. Row Level Security protects all credential and audit tables.

The designated administrator email is `yakubusuleiman3535@gmail.com`. The database assigns ADMIN to this address only after Supabase Auth confirms the email address. In the Supabase Dashboard, open **Authentication → Providers → Email** and make sure **Confirm email** is enabled. Other users can register as Graduate or Employer; no public signup can request ADMIN.

## Run locally

1. Install Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Paste your Supabase Project URL and Publishable Key into `.env`.
4. Run `docker compose up --build`.
5. Visit http://localhost:8080.
6. Register with your email. Confirm the email if Supabase asks you to, then sign in.

For local development without Docker, run `npm install` and `npm run dev`.

## Features

- Supabase email/password authentication
- Role-aware access (ADMIN, GRADUATE, EMPLOYER)
- Admin issuance and revocation workflow
- Graduate credential access
- QR-based public verification
- SHA-256 canonical credential fingerprint
- Audit events
- Solidity certificate registry with optional EVM integration

## Blockchain status

The Solidity contract is in `contracts/CertificateRegistry.sol`. Configure `CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY`, and `CONTRACT_ADDRESS` to enable on-chain operations. Without them, Verity clearly labels its mode as a demo database ledger; it does not claim that public-chain transactions are occurring.

## Security notes

- Never put Supabase secret or service-role keys in this project.
- The publishable key is designed for client-facing use and is safe only with the included Row Level Security policies.
- Keep email confirmation enabled for the designated administrator account.
- Never store student personal data on a public blockchain.
- This prototype does not imply legal recognition, university adoption, or production readiness.