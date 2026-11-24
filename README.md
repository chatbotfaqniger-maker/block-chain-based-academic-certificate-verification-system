# Verity — Blockchain-Based Academic Certificate Verification

A Docker-first academic credential issuance and verification prototype.

## Supabase setup

Verity uses Supabase Auth and the Supabase Data API. Browser authentication and user-scoped data access use the Supabase URL and publishable key. The production server also requires a server-only Supabase service-role/secret key for protected internal RPCs, cross-user in-app notifications and other explicitly privileged operations. It is never exposed to browser code.

Configure for the core application:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Certificate document uploads use the signed-in user's access token and do not require an antivirus scanner. Protected certificate verification and student-registration precheck RPCs are called server-side with the service-role/secret key. Never place that key in frontend configuration or committed source code.

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
- Organization-reported city, state / region and country captured at signup or updated in the organization identity workspace
- Public Global Institutions & Organizations directory with organization-type, name and location filters; only approved organizations that opt into public listing appear
- Organization-specific student / employee membership and registration codes
- Institution student identity console: private CSV roster import (up to 50,000 rows), duplicate-safe matriculation matching, roster status, scoped ICT officer assignment, registration-dispute intake and one-time activation-token issuance
- Student signup begins with matriculation number and approved institution selection; account creation is followed by single-use activation-token verification against the institution roster
- Atomic roster claim prevents duplicate student ownership, marks the token used, activates institution membership and applies the official roster name to the student profile
- ICT can export per-student activation tokens once, reissue an unused token for an eligible unclaimed record, and open an audited dispute for suspected account misclaims; active-account release requires two different authorized officers, is blocked when the claimant has certificate records for that student identity, and preserves the old account and audit trail
- The in-app User Guidelines include a step-by-step Student Registration & Institution Activation walkthrough for graduates and a Student Identity & ICT guide for institutions
- Institution certificate design system: institution-original artwork, VERITY professional templates, drag-and-drop field positioning, owner approval/activation, server-side PDF preview, private SHA-256 document storage, editable CSV/XLSX bulk import, and institution-controlled certificate design and issuance; historical-scan conversion is not yet enabled in the production release
- Organization-scoped certificate issuance, registry and revocation
- Admin issuance and revocation workflow
- Graduate credential access
- Organization staff access limited to the assigned approved organization; currently supports only `certificates:read` and `documents:download` (download requires read access)
- Unique high-entropy certificate verification keys and QR-based public verification
- Separate `ISSUE_CREDENTIALS` and `VERIFY_CREDENTIALS` capabilities, independently requested and reviewed by VERITY administrators; existing `INSTITUTION` and `EMPLOYER` organization types remain unchanged
- Capability-based API and database authorization for roster management, graduate activation, certificate templates, private certificate uploads, individual and bulk issuance, revocation, QR generation, external verification and graduate-consented document access
- Existing university and institution issuer rights and employer verifier rights are preserved by an explicit baseline-capability backfill; additional capabilities are never granted automatically
- Primary, secondary and tertiary education-level metadata; one school organization account can select both primary and secondary levels
- The issuer capability reuses the existing student roster, activation-token workflow, Certificate Design Studio, uploaded PDF/image artwork, editable student data, private storage buckets, certificate ledger and three existing bulk-issuance methods; no parallel upload or certificate engine is introduced
- Capability expansion is on the isolated feature branch and is not production-active until the migrations, regression suite and application release are reviewed and deployed
- Authenticated verification requests attributed to approved verifier organizations
- Graduate-controlled, time-limited (30-day) consent for verifier organizations to view original certificate documents, with graduate-initiated revocation, clear expiry states and repeat requests after rejection, revocation or expiry
- SHA-256 canonical credential fingerprint
- Audit events
- Issue Resolution Centre available in every signed-in workspace: submit and track issue reports, with institution-owner and System Administrator status-management boundaries
- Solidity certificate registry with optional EVM integration



## Issue Resolution Centre

Every signed-in role can submit an issue report and track its ticket reference and status. Institution owners can review reports associated with their institution; VERITY System Administrators can review platform-wide reports. Updates are restricted to workflow status fields and are recorded in the audit history. The support centre provides private threaded conversations between users/organization owners and VERITY Admin, ticket references, status tracking, audit history and private file attachments. Attachments are stored in a private Supabase Storage bucket and are shared only with conversation participants through short-lived signed links. Supported uploads: images, PDF, text, Word and Excel files, up to 10 MB each and five files per message. It does not claim automatic diagnosis or automatic repair. Destructive or privileged repairs remain restricted to authorized platform operations.

The applied database schema and Row Level Security policies are documented in [Issue Resolution SQL](docs/VERITY-ISSUE-RESOLUTION-CENTRE.sql) and [Support Chat SQL](docs/VERITY-SUPPORT-CHAT-SQL.sql).

## Complete documentation

The full user and operations manual is available here:

**[VERITY Complete User and Operations Guide](docs/VERITY-COMPLETE-USER-AND-OPERATIONS-GUIDE.md)**

It covers graduate onboarding and credential access, institution approval and issuance, employer verification and graduate consent, staff permissions, System Administrator workflows, the end-to-end credential lifecycle, document security, troubleshooting, deployment configuration and a production-readiness checklist.

## Certificate design system

VERITY is designed to support institution-approved original artwork, built-in professional templates and controlled digitisation of previously issued certificates. The three paths share the existing certificate registry, unique verification references, SHA-256 integrity checks and append-only ledger. See [Certificate Design System Decision](docs/VERITY-CERTIFICATE-DESIGN-SYSTEM.md) and the [Complete User and Operations Guide](docs/VERITY-COMPLETE-USER-AND-OPERATIONS-GUIDE.md). The feature branch implements the design studio, validated field positioning, explicit owner approval/activation, watermarked previews, single-issuance PDF generation and durable bulk template-generated PDFs. Institution bulk import accepts CSV and XLSX workbooks, presents editable student rows with field-level validation, and retains the existing ZIP/multiple-PDF upload options. Historical certificate scan conversion is not included in the current production release. The historical-case database model, institution review workflow and atomic conversion transaction must be implemented and tested together before this capability is advertised or enabled. Original scans must remain private evidence; no certificate should be issued from a historical scan until the institution approval and identity checks are complete. Do not treat the feature branch as production-ready until the stacked pull requests are reviewed and all release checks are complete.

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

- Never commit Supabase secret or service-role keys or expose them to browser code. User-scoped document workflows use the signed-in user session; protected internal RPCs and cross-user notification operations require the server-only key.
- The publishable key is designed for client-facing use and is safe only with the included Row Level Security policies.
- Email-confirmation behavior is controlled in the Supabase Auth dashboard; Verity does not override that setting.
- VERITY does not scan uploaded files for malware. File-signature checks and SHA-256 integrity checks are not antivirus protection; accept uploads only from trusted sources and use endpoint protection on the systems handling them.
- Never store student personal data on a public blockchain.
- This prototype does not imply legal recognition, university adoption, or production readiness.

## Student Identity & Registration Management (locked product requirement)

VERITY will use a roster-backed student identity workflow for institution onboarding at scale. This is a core product requirement, not an optional convenience feature.

### Approved registration policy
- Students should normally self-register remotely; routine physical visits to institution ICT are not required.
- The matriculation number is an identifier, not proof of identity. A matching number alone must never activate or transfer a student account.
- Only an approved academic institution can import and manage its private student roster. The roster is matched by institution and normalized matriculation number, with duplicate detection and import audit history.
- The student enters the matriculation number first, then selects the institution. VERITY must not disclose another student's private details when a lookup fails or a record is already claimed.
- Account activation requires a private, high-entropy, single-use token generated for the exact roster record by an authorized institution owner or ICT officer. The token is delivered to the matching student through an institution-approved channel; the student cannot replace the destination with an arbitrary contact to claim another person's record.
- After account creation, the student submits the token. A database transaction locks the roster record, consumes the token, links the Graduate account, activates membership and applies the institution's official roster name. Shared/default passwords and institution codes as passwords are prohibited.
- Records not found in the roster, inaccessible institutional contacts and disputed claims are routed to the institution's authorized ICT team.

### Institution invitation code policy
The institution's registration/invitation code does not expire by default. Expiry is disabled unless the institution explicitly enables it and chooses an expiry. The code is an onboarding reference only; it is never a password or proof that a person owns a matriculation number. Rotating the code must not detach existing students.

### Institution ICT privilege and identity recovery
- The institution owner can appoint and revoke multiple Institution ICT officers with scoped roster:manage and registration:recover privileges.
- ICT can import and correct roster records, inspect claim status and relevant claim history, open disputes, and initiate controlled recovery after checking the student's identity against official institutional records.
- If an activation has not completed, ICT may invalidate the outstanding activation attempt and reissue a fresh single-use activation challenge after verification.
- If an account is already active, ICT must not silently detach, overwrite or transfer it. A documented dispute requires a first review and a second approval by a different authorized officer. The system releases the old membership only when no certificate history exists for that claimant and institution; otherwise the case is escalated to VERITY Admin.
- Recovery never reveals passwords or reusable authentication secrets. Tokens are random, single-use, stored as hashes, rate-limited and invalidated on replacement.
- Student roster information, institutional contact details and claim history are private and available only to authorized institution owner/ICT staff and the relevant student through purpose-limited flows.

### Implementation status
The database foundation, roster-first student signup, one-time hashed activation tokens, atomic student claim, token export/reissue, scoped ICT permissions, claimant visibility and two-person recovery review are implemented and deployed. CSV import supports up to 10,000 records. Direct .xlsx import and VERITY Admin review for disputed claims with certificate history remain outstanding. Full real-account end-to-end testing is still required.

## Organization and student onboarding

1. A university, school, college, or employer registers using **Organization Admin** and may provide its public-facing city, state / region and country (no street address is requested).
2. Verity creates an organization profile in **Pending** status.
3. The System Admin reviews and approves the organization.
4. Once approved, the organization can opt in or out of the public directory. The directory shows the city, state / region and country supplied by the organization, clearly labelled as organization-reported rather than independently verified. Approved owners can update only these location fields; legal identity changes require a new VERITY review.
5. Once approved, the Organization Admin shares its generated registration code with students or employees.
6. Students register as **Graduate** and enter the code during signup, or sign in and use **Join an institution** later.
7. The Organization Admin reviews requests under **Students / Employees** and approves or rejects them.
8. Organizations can issue credentials only when their organization identity is approved and their `ISSUE_CREDENTIALS` capability is approved. Organizations can verify other issuers' credentials only when their `VERIFY_CREDENTIALS` capability is approved. The capabilities are independent; an organization may receive both only after separate approval.
9. Each credential receives a unique certificate ID, high-entropy verification key and QR verification URL. Institution admins must upload the official certificate document during registration.
10. Approved employer-type verification organizations can search by certificate ID or verification key. Verity records the organization making each authenticated lookup.
11. A verifier must request permission from the linked graduate before viewing the original certificate document. Graduate approval expires after 30 days. Original documents remain private and are released only while the approved consent is valid and the stored file passes its SHA-256 integrity check.
12. Public QR / key verification displays limited credential information and does not automatically reveal the private original document.

The database keeps organization profiles and memberships in separate tables and uses Row Level Security to scope records. The existing EMPLOYER database enum value represents the Organization Admin role; ADMIN remains reserved for the Verity platform administrator.

### Institution identity registry

Institution administrators submit their official registration number, official website, accreditation/supervising body, and supporting registration or accreditation evidence. The application remains PENDING until a Verity platform administrator reviews the details and evidence. Organization names alone are not proof of institutional identity. Evidence files are stored in a private bucket and are not publicly accessible. The current workflow is a human review process; it does not claim automated validation against government or regulator registries.


## Customer notifications and Admin announcements

The Support & Communication Centre includes a browser-notification opt-in, private conversation assignment to a VERITY administrator, unread-reply counts and an Admin-only broadcast email composer. Background Web Push requires HTTPS, browser permission, the Web Push VAPID key pair, and a server-only Supabase service-role/secret key so the server can deliver to other users' subscriptions. If those server settings are absent, the UI remains available but push delivery is not active. Email broadcast requires an SMTP sender configured on the Render service; it sends to registered profile email addresses in batches and records the result in the audit history. Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_SERVICE_ROLE_KEY, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM as server-only Render environment variables. Never put private keys or SMTP credentials in frontend code or committed files. The application does not claim that browser push or email is active until the required provider configuration is supplied and delivery is verified.


## Platform-wide Notification Centre

All authenticated roles have a Notification Centre for account and organization status, certificate issuance and revocation, graduate consent/access requests, support conversations, and platform announcements. It provides in-app history, unread counts, mark-read controls, browser push opt-in, and per-category in-app/push preferences. Current event triggers include new organization registration (Admin), organization approval/status change (owner), certificate issue/revocation (graduate and Admin), certificate access request (graduate and Admin), graduate access decision (requesting organization), and support conversation/replies (participants and Admin). Background push requires HTTPS, browser permission, VAPID keys, and SUPABASE_SERVICE_ROLE_KEY configured server-side. Cross-user in-app event creation also requires that server-only Supabase key. Email category preferences are stored for future transactional delivery; current email broadcast is the Admin bulk-announcement feature and requires SMTP settings. Do not describe unconfigured email delivery as active.

## Public verification and RPC security controls

The public `POST /api/verify` application endpoint is rate-limited per client IP (30 requests per minute); organization verification is limited to 20 requests per minute and organization student lookup to 15. These application-level controls protect the Render API routes; they do not claim that direct Supabase Data API traffic uses the same per-IP limiter.

Sensitive certificate lookup, ledger integrity verification and student-registration precheck RPCs are executable only by the server-side `service_role` and are called through rate-limited Express endpoints. Public execution remains only for limited approved-issuer, public institution-directory and student signup institution-discovery functions. Student activation, roster access, membership requests, recovery actions and organization settings remain authenticated-only with explicit user/organization permission checks.

Default function privileges for the migration owner (`postgres` in the production migration session) are hardened so new public-schema functions are not automatically executable by `anon` or `authenticated`. Cross-role default-privilege changes are not performed by the production migration. Future RPC migrations must explicitly grant only the roles they require. Certificate rows are immutable after issuance: the database validates the SHA-256 digest, permits only ACTIVE-to-REVOKED status changes, prevents deletion, and checks that the current record matches its latest append-only ledger event. The `CertificateLedger` table is read-only to `service_role`; its owner-controlled trigger is the only application write path. RLS-bypassing `TRUNCATE` privileges are revoked from application roles across the public schema. Supabase Auth leaked-password protection is a dashboard-level, plan-dependent control (currently documented for Pro and higher plans). Enable it in the Supabase Auth password-security settings if the existing project plan supports it; do not upgrade solely for this setting. Keep the strongest password length/character policy available on the current plan and retain the application rate limits.

## Production migration history

The production database's applied migration history must match the repository before using automated Supabase CLI migration pushes or resets. See [Production Migration-History Reconciliation](docs/PRODUCTION-MIGRATION-RECONCILIATION.md) for the current audit and release safety rules. Do not run `supabase db push` or replay missing historical migrations against production until the reconciliation is complete.

## Durable institutional student roster import

Approved credential issuers can import up to 50,000 student rows per batch from the VERITY CSV template. The application validates the file in the browser, stages it in 100-row chunks, and processes those chunks through a durable PostgreSQL queue. Imports extend the existing `StudentRoster` identity registry; they do not create graduate login accounts or issue certificates. New rows enter the existing `ELIGIBLE` state and continue through the established single-use activation-token workflow.

The import worker runs inside the existing Node/Express web service, so it does not require a separate paid Render worker service. To process queued batches, configure the server-only `SUPABASE_SERVICE_ROLE_KEY` (or supported Supabase secret key) and set `ENABLE_STUDENT_IMPORT_WORKER=true` in Render. Keep the worker disabled until the matching database migration is applied. If the worker is disabled, batches remain safely queued and the interface displays that status. The worker uses a transaction-scoped `FOR UPDATE SKIP LOCKED` queue, retry-safe chunk staging, and the existing institution/matriculation uniqueness constraint; it never overwrites existing student records. Institution owners and active ICT staff with `roster:manage` can import and view the batch history.

## Durable bulk certificate issuance

Approved credential-issuer owners can create issuance campaigns of up to 50,000 certificates using three methods: CSV + ZIP of existing PDFs, CSV + multiple selected PDFs, or VERITY-generated certificate PDFs. VERITY automatically orchestrates each campaign as durable processing batches of up to 500 items; the 500-item worker chunk is not a campaign limit. Institutions can create additional campaigns for further cohorts. Student data can be imported from CSV UTF-8 or a standard unencrypted XLSX workbook (first worksheet); imported student fields are editable in VERITY before submission. Required fields, email, award dates and duplicate matriculation numbers are revalidated after edits, and invalid rows block submission. Legacy XLS and encrypted workbooks are not supported. Existing PDF filenames must match the student's normalized student number. Each PDF is limited to 10 MB and each ZIP to 250 MB.

Student identity and editable certificate fields remain structured PostgreSQL records; the existing private Supabase Storage buckets continue to hold original certificate PDFs and institution artwork, with each storage path mapped to its corresponding student/certificate record. VERITY does not create a second student-data upload system or replace the Certificate Design Studio. The application stages PDFs in the private verity-certificates bucket, validates the PDF signature and SHA-256 fingerprint, and records immutable campaign/batch/item payloads in PostgreSQL. A durable worker inside the existing Node/Express Render service issues each certificate into the Supabase ledger, attaches its document and records audit activity. The worker uses per-item idempotency, bounded retries and expired-lease reconciliation; it checks the certificate ledger before recovering an uncertain item, so it does not blindly issue duplicates. Bulk issuance deliberately does not submit per-certificate blockchain transactions.

Configure the server-only SUPABASE_SERVICE_ROLE_KEY and set ENABLE_BULK_CERTIFICATE_WORKER=true only after the matching queue migration has been reviewed, applied and the application deployed. Keep the flag false until then. The bulk issuance interface displays whether the worker is ready. Document uploads are private and SHA-256 checked; VERITY does not perform antivirus scanning.

See docs/USER_GUIDE.md for the institution workflow and recovery instructions.

## Controlled production release decisions (24 November 2026)

The approved release sequence for the durable bulk certificate issuance and certificate-ledger hardening changes is **PR #8 first, then PR #9**. This sequence preserves the existing Supabase-first architecture and the currently deployed application service; it is not authorization to replace the database, authentication model, deployment platform, or blockchain integration.

### Locked architecture and release rules

- Supabase remains the active system of record for authentication, organization and student identity, certificate records, private documents, verification and the append-only certificate ledger.
- The existing Render Docker web service remains the application deployment target. No additional worker service or paid infrastructure is required by PR #8.
- Blockchain remains optional and disabled for normal operation. Existing certificates remain verifiable without a wallet, RPC endpoint, gas, contract or chain transaction.
- Production changes must be additive and applied one reviewed migration at a time. Do not reset migration history, replay missing historical migrations, or run automated supabase db push against production while reconciliation is incomplete.
- The production audit after PR #9 reports 59 applied migration versions, 24 SQL migration files in the repository, and 43 applied versions without matching repository files; 16 repository migration files now match applied production versions. Preserve this history; the discrepancy is not permission to reconstruct or replay migrations blindly.
- PR #8 must be merged and its additive queue migration applied before PR #9 is retargeted to main. PR #9 must then be reviewed against the updated main, merged, and its security migration applied as a separate operation.
- The bulk certificate worker remains disabled until the PR #8 migration is confirmed applied, the matching application deployment is live, and a server-only Supabase service-role/secret key is confirmed configured. Never expose this key to browser code, logs, README content or committed source.
- The Render integration exposes service and deployment metadata but does not expose environment-variable names or values for inspection. Therefore, do not claim that the required server-only key is configured based solely on the Render service listing. Verify its presence in the Render Dashboard without copying or revealing its value.
- After each migration and deployment, verify the existing signup, institution approval, student activation, certificate issuance/revocation, public verification, organization verification, ledger integrity, and document-access workflows before proceeding to the next stage.
- If any migration, deployment, or regression check fails, stop the sequence, keep optional workers disabled, preserve the live service, and resolve the issue before continuing. Do not automatically roll back or rewrite production data.

### Release record

- **PR #8 — Durable bulk certificate issuance:** merged first; application deployment is live and migration `20261124071328_durable_bulk_certificate_issuance_queue` is applied and verified. CSV/ZIP and multiple-PDF options do not change the underlying institution ownership, certificate ledger, or blockchain policy.
- **PR #9 — Certificate ledger integrity hardening:** merged as `419424bb859c7e184769df538527bd34917b2b3b`; Render deployment is live. Migration `20261124074628_certificate_ledger_integrity_hardening` is applied. Production checks confirm the existing certificate and ledger event remain present, the ledger hash-chain and current-record match both pass, application roles have no public-table TRUNCATE privileges, and `service_role` is read-only on `CertificateLedger`.
- **Environment verification:** the production health endpoint reports `inAppConfigured: true` and `browserPushConfigured: true`; admin email remains unconfigured.
- **Worker activation:** explicitly not authorized by this release record; keep disabled until its prerequisites and operational checks pass.

This section is the locked implementation and release decision record. Any future change to these decisions must be documented here before implementation.

### Documentary runtime and content
- The VERITY User Guide product documentary is designed for a 120-second (two-minute), nine-scene experience in both the interactive showcase and administrator MP4 export.
- The extended edition explains student identity registration and institution ICT recovery, roster import and reviewed bulk certificate issuance, organization legal registration and directory discovery, and the Supabase append-only SHA-256 certificate ledger.
- The MP4 generator and in-app showcase must remain duration-aligned. Verify the generated file's actual duration and playback after deployment; a source-code change alone is not proof of a successfully rendered MP4.
