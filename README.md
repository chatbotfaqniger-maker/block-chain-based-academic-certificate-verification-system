# Verity — Blockchain-Based Academic Certificate Verification

A Docker-first prototype aligned with the supplied Chapters 1–3. It provides university registry issuance, graduate credential access, and employer verification.

## Current implementation
- Role-aware authentication (ADMIN, GRADUATE, EMPLOYER)
- Admin issuance and revocation workflow
- Graduate certificate listing
- QR-based public verification lookup
- SHA-256 canonical credential fingerprint
- Solidity registry contract with issuer authorization and revocation
- Optional EVM adapter; clearly labels database-ledger mode when no chain is configured
- PostgreSQL persistence, audit events, Docker Compose and Render Blueprint

## Run locally
1. Install Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Change `JWT_SECRET` and bootstrap admin credentials.
4. Run `docker compose up --build`.
5. Visit http://localhost:8080 and sign in with the bootstrap admin credentials from `.env`.

## Blockchain
The Solidity contract is in `contracts/CertificateRegistry.sol`. Compile with `npm run chain:compile`. Configure `CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY`, and optionally `CONTRACT_ADDRESS` to enable on-chain operations. A funded deployment wallet and a supported EVM network are required for public-chain use.

If no RPC and signer are configured, the application deliberately operates in `DEMO_DATABASE_LEDGER` mode. It must not be described as on-chain verification in this mode.

## Render
`render.yaml` describes a Docker web service and a PostgreSQL database. Review the Blueprint plan and select/confirm the intended resources before applying. Set the bootstrap email and strong password as secrets in Render. For a public chain, also configure the chain RPC, authorized issuer wallet, and contract address.

## Security and academic limitations
- Never put student names, matriculation numbers, email addresses, or certificate files on a public blockchain.
- The QR code is a locator, not an authenticity proof.
- Certificate hashes provide integrity checks; issuer authorization and institutional governance establish trust.
- Configure HTTPS, backups, rate limits, monitoring, secret rotation, and production security review before real institutional use.
- This prototype does not imply legal recognition, university adoption, or production readiness.
