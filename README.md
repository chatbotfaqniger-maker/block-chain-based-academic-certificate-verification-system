# Verity — Blockchain-Based Academic Certificate Verification

A Docker-first academic credential issuance and verification prototype.

## Supabase setup

Verity uses Supabase Auth and the Supabase Data API. Core authentication and credential workflows do **not** need a PostgreSQL connection string, database password, Prisma setup, Supabase secret key, or service-role key.

Configure for the core application:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Certificate uploads do not require a scanner service or Supabase service-role key. The server uses the Supabase Publishable Key with the signed-in user's access token; never place secret or service-role keys in frontend configuration or committed source code.

The database migration creates the Auth-to-profile trigger, access policies, and a restricted public certificate lookup function. Row Level Security protects all credential and audit tables.

The designated administrator email is `yakubusuleiman3535@gmail.com`. The database assigns ADMIN to this address only after Supabase Auth confirms the email address. Email confirmation behavior is controlled by the Supabase Auth dashboard setting; Verity does not override or modify that setting. Other users can register as Graduate or Employer; no public signup can request ADMIN.

## Run locally

1. Install Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Paste your Supabase Project URL and Publishable Key into `.env`.
4. Run `docker compose up --build`.
5. Visit http://localhost:8080.
6. Register with your email. Complete any email-confirmation step only if it is enabled in your Supabase Auth settings, then sign in.

For local development without Docker, run `npm install` and `npm run dev`.

## Features

- Supabase email/password authentication
- Role-aware access (System Admin, Organization Admin, Student / Graduate)
- Role-filtered User Guidelines with dedicated module walkthroughs, action references, permissions, warnings and troubleshooting
- 90-second cinematic in-app VERITY product film using live dashboard totals and an interactive credential verification action
- Institution staff access scoped to their own approved institution, with only `certificates:read` and `documents:download` implemented; document downloads require both permissions and never grant issuance or revocation authority
- Organization registration with System Admin approval
- Organization-specific student / employee membership and registration codes
- Student institution-link requests and organization approval workflow
- Organization-scoped certificate issuance, registry and revocation
- Admin issuance and revocation workflow
- Graduate credential access
- Organization staff access limited to the assigned approved organization; currently supports only `certificates:read` and `documents:download` (download requires read access)
- Unique high-entropy certificate verification keys and QR-based public verification
- Separate issuer and verifier organization workflows; only approved academic institutions can issue credentials
- Authenticated verification requests attributed to approved verifier organizations
- Graduate-controlled, time-limited (30-day) consent for verifier organizations to view original certificate documents
- SHA-256 canonical credential fingerprint
- Audit events
- Solidity certificate registry with optional EVM integration



## Complete documentation

The full user and operations manual is available here:

**[VERITY Complete User and Operations Guide](docs/VERITY-COMPLETE-USER-AND-OPERATIONS-GUIDE.md)**

It covers graduate onboarding and credential access, institution approval and issuance, employer verification and graduate consent, staff permissions, System Administrator workflows, the end-to-end credential lifecycle, document security, troubleshooting, deployment configuration and a production-readiness checklist.

## Supabase-first, blockchain-ready architecture

Supabase is VERITY's active system of record and the only required platform for normal operation today. Authentication, organization onboarding and approval, certificate issuance, graduate access, sharing permissions, public verification, document storage, and audit events continue to work without an RPC endpoint, wallet, gas, smart contract, or blockchain credentials.

Blockchain is a planned, optional verification/anchoring layer. It must never be required for signup, login, certificate issuance, QR generation, graduate sharing, or Supabase-based verification. Existing certificates without a chain transaction remain fully verifiable from their Supabase records and SHA-256 integrity checks, even after a future blockchain integration is introduced. Do not publish student personal information or original certificate documents on a public chain.

The Solidity contract and EVM adapter are retained for a future implementation. The adapter is disabled by default. The future activation work must add a non-blocking, retryable anchoring workflow, persist anchor status/transaction metadata, and verify chain anchors only for certificates that actually have one. A chain outage, missing gas, or unconfirmed transaction must not interrupt core VERITY workflows.

To keep blockchain disabled (the current supported operating mode), leave `VERITY_BLOCKCHAIN_MODE=disabled`. Do not enable the future adapter in production until the asynchronous anchoring workflow, failure/retry handling, key custody, and backward-compatibility tests have been implemented and approved.

## Document security

VERITY does **not** perform antivirus or malware scanning. Certificate and organization-evidence uploads are restricted to PDF, JPEG and PNG, checked against their file signatures, limited to 10 MB and stored in private Supabase Storage buckets. VERITY calculates a SHA-256 fingerprint at upload and compares the stored file against that fingerprint before preview or download. A mismatch or missing fingerprint blocks release.

Access remains restricted by authenticated role, institution ownership, staff permissions, organization approval and graduate consent. Employer access to an original certificate requires an approved, unexpired graduate grant. Employer downloads are generated as watermarked PDF copies. Signed preview links are short-lived.

**Required database update:** apply `supabase/migrations/20261121120000_remove_antivirus_scan_gates.sql` in the Supabase SQL Editor before testing document previews and downloads. It removes the obsolete `CLEAN` scan-status predicates from the two certificate read policies while retaining private-bucket, tenant, staff and graduate-consent checks. The migration updates the two certificate Storage read policies while preserving their private-bucket, tenant, staff and graduate-consent checks; do not make the buckets public.

## Security notes

- Never commit Supabase secret or service-role keys or expose them to browser code. VERITY document workflows use the signed-in user session and do not require a service-role key.
- The publishable key is designed for client-facing use and is safe only with the included Row Level Security policies.
- Email-confirmation behavior is controlled in the Supabase Auth dashboard; Verity does not override that setting.
- VERITY does not scan uploaded files for malware. File-signature checks and SHA-256 integrity checks are not antivirus protection; accept uploads only from trusted sources and use endpoint protection on the systems handling them.
- Never store student personal data on a public blockchain.
- This prototype does not imply legal recognition, university adoption, or production readiness.

## Organization and student onboarding

1. A university, school, college, or employer registers using **Organization Admin**.
2. Verity creates an organization profile in **Pending** status.
3. The System Admin reviews and approves the organization.
4. Once approved, the Organization Admin shares its generated registration code with students or employees.
5. Students register as **Graduate** and enter the code during signup, or sign in and use **Join an institution** later.
6. The Organization Admin reviews requests under **Students / Employees** and approves or rejects them.
7. Only approved organizations whose type is INSTITUTION can issue and revoke academic credentials. Employer-type organizations are verifiers and cannot issue certificates.
8. Each credential receives a unique certificate ID, high-entropy verification key and QR verification URL. Institution admins must upload the official certificate document during registration.
9. Approved employer-type verification organizations can search by certificate ID or verification key. Verity records the organization making each authenticated lookup.
10. A verifier must request permission from the linked graduate before viewing the original certificate document. Graduate approval expires after 30 days. Original documents remain private and are released only while the approved consent is valid and the stored file passes its SHA-256 integrity check.
11. Public QR / key verification displays limited credential information and does not automatically reveal the private original document.

The database keeps organization profiles and memberships in separate tables and uses Row Level Security to scope records. The existing EMPLOYER database enum value represents the Organization Admin role; ADMIN remains reserved for the Verity platform administrator.

### Institution identity registry

Institution administrators submit their official registration number, official website, accreditation/supervising body, and supporting registration or accreditation evidence. The application remains PENDING until a Verity platform administrator reviews the details and evidence. Organization names alone are not proof of institutional identity. Evidence files are stored in a private bucket and are not publicly accessible. The current workflow is a human review process; it does not claim automated validation against government or regulator registries.
