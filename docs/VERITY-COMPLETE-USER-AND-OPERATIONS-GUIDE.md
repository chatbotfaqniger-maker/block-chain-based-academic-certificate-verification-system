# VERITY — Complete User and Operations Guide

**Product:** VERITY Academic Credential Network  
**Purpose:** Issue, manage, share and verify academic credentials with controlled access, an auditable registry and optional EVM blockchain integration.

This guide explains the current application workflows. Screen labels may vary slightly as the interface evolves. Follow the permissions enforced by the server; a visible button is not a substitute for authorization.

---

## 1. Understand VERITY

VERITY connects three main participants:

- **Academic institutions** create and manage academic credentials for their graduates.
- **Graduates** access their own credentials, share verification references and control requests to view private original documents.
- **Verifier organizations** (such as employers) check credential records and request document access when necessary.
- **VERITY System Administrators** review organizations, oversee platform records and inspect audit activity.

### 1.1 Important terminology

| Term | Meaning |
|---|---|
| Certificate / credential | The academic award record registered in VERITY. |
| Certificate ID | The unique public-facing identifier assigned to a credential. |
| Verification key | A separate high-entropy secret/reference used to look up a credential. Treat it as sensitive and share it only with the intended recipient. |
| QR / verification link | A convenient route to the credential verification experience. |
| Credential fingerprint | SHA-256 digest of the canonical academic data used to detect changes to the registered details. |
| Issuer | An approved organization whose type is **INSTITUTION**. |
| Verifier | An approved organization whose type is **EMPLOYER**. |
| Membership | A graduate's approved link to an institution or organization. |
| Consent | A graduate's time-limited approval for an authorized verifier organization to view the private original certificate document. |
| Audit event | A server-recorded activity entry used for accountability and investigation. |
| Supabase certificate ledger | A persistent append-only database ledger that records certificate issuance and revocation events and links entries with SHA-256 hashes. It is not a public blockchain. |
| Ledger hash | A SHA-256 value calculated from the preceding ledger hash and the current event data. It helps detect changes to the recorded event sequence. |
| Blockchain anchor | An optional future/public-chain record of a credential fingerprint. It is separate from the active Supabase ledger and is currently disabled. |

### 1.2 Organization account roles

The current authentication model uses the application role **EMPLOYER** for an organization owner/administrator account. The organization profile separately identifies its organization type:

- **INSTITUTION:** an academic issuer, subject to VERITY approval.
- **EMPLOYER:** a verifier organization, subject to VERITY approval.

A graduate account uses the **GRADUATE** role. The platform administrator uses **ADMIN**. Do not confuse an organization's type with the account's authentication role.

---

## 2. Getting started

### 2.1 Create an account

1. Open the VERITY application using the official URL supplied by your institution or VERITY administrator.
2. Select the registration option.
3. Enter your full name, email address and password. Use a strong, unique password that is at least 10 characters long.
4. Choose the appropriate account type:
   - **Graduate** for an individual receiving or managing credentials.
   - **Organization Admin** for an institution or verifier organization representative.
5. If registering an organization, enter its organization name and select whether it is an **Institution** or **Employer / verifier**. Provide the requested registration details.
6. If registering as a graduate with an institution registration code, enter the code and your student number where requested.
7. Submit the registration form.
8. If email confirmation is enabled for the deployment, open the confirmation email and complete the confirmation step.
9. Sign in with your email and password.

**Important:** Public registration cannot create a System Administrator account. Administrator access is reserved for the designated platform administrator and is assigned by the trusted database/authentication setup.

### 2.2 Sign in and sign out safely

- Use the email address associated with your VERITY account.
- If sign-in fails, check the email spelling, password and any required email confirmation.
- Sign out when using a shared or public computer.
- Never share your password, session token or another person's account.

### 2.3 Account recovery

Use the account provider's supported password recovery flow if it is enabled for your deployment. Do not send passwords or one-time recovery codes to support staff. If recovery is unavailable, contact the VERITY deployment administrator through an independently trusted support channel.

---

## 3. Organization onboarding and approval

This process applies to both academic institutions and verifier organizations.

### 3.1 Register the organization

1. Create an Organization Admin account.
2. Enter the official organization name and select the correct organization type.
3. Supply the requested registration information.
4. Submit the registration.
5. Sign in and open the organization workspace.
6. Confirm that the organization application is shown as **PENDING**.

A registration code is generated for the organization. Keep it private until the organization is approved and ready to invite its intended members.

### 3.2 Complete institution identity details

For an academic institution, provide the official identity information requested in the Institution Identity area, including:

- Official registration number.
- Official website.
- Accreditation or supervising body.
- Official email domain, where applicable.
- Supporting registration or accreditation evidence.

Submit clear, current evidence that belongs to the institution. Evidence is stored in a private storage area for human review.

### 3.3 VERITY review

A System Administrator reviews the organization details and evidence. The decision is a manual review; the current workflow does not claim automated verification against government or regulator databases.

Possible outcomes include:

- **PENDING:** waiting for review or further action.
- **APPROVED:** approved services become available according to the organization's type.
- **SUSPENDED:** organization services are blocked while the suspension is in effect.

Do not repeatedly submit duplicate applications while a review is pending. If clarification is requested, provide the requested information through the official support or application process.

### 3.4 What approval enables

- An approved **INSTITUTION** can manage its student memberships and issue/revoke its own academic credentials, subject to server-side permissions.
- An approved **EMPLOYER** organization can use the verifier workflow. It cannot issue academic certificates.
- Approval does not mean that VERITY has independently guaranteed every future credential; each credential must still be checked.

---

## 4. Graduate / student guide

### 4.1 Join an institution

There are two supported entry points:

**During registration**
1. Obtain the correct registration code directly from your institution.
2. Register as a Graduate.
3. Enter the organization registration code and your student number if requested.
4. Complete any email-confirmation step.
5. Sign in and check your membership status.

**After registration**
1. Sign in to VERITY.
2. Open **Join an Institution**.
3. Enter the registration code supplied by your institution.
4. Enter your student number if requested.
5. Submit the request.
6. Wait for the institution administrator to review it.

A request is not an approved membership. The institution must compare the submitted details with its own official records.

### 4.2 Membership status

- **Pending:** the institution has not completed its review.
- **Approved:** the account is linked to the organization.
- **Rejected:** the institution did not approve the request. Contact the institution to correct inaccurate details before submitting another request.

Do not use a registration code found in a public post or from an unknown person. Ask the institution for its current code.

### 4.3 View My Credentials

1. Sign in as a Graduate.
2. Open **My Credentials**.
3. Review the listed award, issuing institution, qualification and current status.
4. Select a credential to inspect the available details.
5. Use the QR or verification-link control when you need to share a reference with a verifier.
6. Keep your verification key private except when sharing it with the intended recipient.

Only credentials linked and visible to your account should appear here. If an expected credential is missing, first confirm that your institution membership is approved and contact the institution's records office to check the registered student details.

### 4.4 Share a credential safely

You may share the credential's QR code, verification link, certificate ID or verification key as supported by the interface.

Recommended practice:

1. Confirm that the recipient is the organization or person who needs to verify your award.
2. Share only the reference needed for the check.
3. Do not post your verification key publicly.
4. Remember that a public registry check provides limited credential information; it does not automatically grant access to your original certificate document.
5. If the recipient needs the original document, ask them to submit a document-access request through the authorized verifier workflow.

A QR code or successful registry lookup confirms a record match, not the presenter's personal identity. A verifier may need separate identity checks.

### 4.5 Respond to document-sharing requests

1. Open **Sharing Requests** or the access-request area in your Graduate workspace.
2. Review the requesting organization and the credential involved.
3. Confirm that the organization and purpose are legitimate.
4. Approve only if you want that verifier organization to view the original document.
5. Reject requests you do not recognize or do not wish to approve.

The current consent period is **30 days**. Approval is time-limited and applies to the relevant verifier/document workflow. It does not make the document publicly accessible. Do not approve a request simply because the requester claims that it is urgent.

### 4.6 Graduate privacy responsibilities

- Keep your login credentials and verification key private.
- Share credential references only with intended recipients.
- Review the organization name and request details before granting document access.
- Contact your institution if your name, student number, programme or award details are incorrect.
- Contact VERITY support if you see an unfamiliar access request or activity.

---

## 5. Academic institution administrator guide

### 5.1 Institution Identity

1. Sign in using the Organization Admin account registered for your institution.
2. Open **Institution Identity**.
3. Check the organization name and application status.
4. Enter the official registration number, website, email domain and accreditation/supervising body where requested.
5. Upload the supporting registration or accreditation evidence.
6. Submit the information and wait for the System Administrator's decision.

While the application is pending, correct incomplete details if the interface allows it. Once approved, identity details may be locked from editing; contact VERITY support if an approved institution needs a correction.

### 5.2 Manage Students / Employees

1. Open **Students / Employees**.
2. Copy the institution registration code using the copy control.
3. Share it directly with the intended students through an institution-controlled channel.
4. Review pending membership requests.
5. Compare the applicant's name and student/matriculation number with authoritative institution records.
6. Approve a matching request or reject an incorrect or unauthorized request.
7. Follow up with the student if the submitted details need correction.

Never approve a membership based only on a matching name. Registration codes are invitations and should not be published openly.

#### 5.2.1 Bulk student import and roster management

The Bulk student import module is available to an approved academic institution owner. It supports controlled CSV imports for large cohorts without creating a Verity login account for every student.

1. Open **Bulk student import** from the Institution workspace.
2. Download the official VERITY CSV template.
3. Export the relevant student records from the institution's student information system and populate the required columns:
   - `student_number`
   - `full_name`
   - `faculty`
   - `department`
   - `programme`
   - `qualification`
4. Optional columns are `email`, `classification` and `award_date` (YYYY-MM-DD).
5. Save the file as CSV and upload it. The browser validates the file and shows a preview before submission.
6. Correct missing required values, invalid email/date values and duplicate student numbers within the file.
7. Start the import. VERITY stages records in sequential batches of up to 100 rows and then submits the batch to its durable database queue.
8. Once the batch shows **QUEUED**, the browser is no longer responsible for processing the records. The server worker processes queued chunks and updates the batch status and progress.
9. Review Import history for inserted records, duplicates, rejected rows, failed chunks and processing progress.


**Background worker configuration (administrator/deployment task)**

- The queue is stored in Supabase Postgres. Each staged chunk is processed transactionally; a worker restart does not discard queued chunks.
- To enable processing, first reconcile and apply the reviewed VERITY import migration, then configure the Render web service with the server-only `SUPABASE_SERVICE_ROLE_KEY` and `ENABLE_STUDENT_IMPORT_WORKER=true`.
- Never put the service-role/secret key in Vite variables, browser code, public documentation values or Git.
- If the worker is disabled, batches remain queued and the page will explicitly report that processing is not active. Do not tell users their records have been imported until the batch reaches **COMPLETED** or **PARTIAL**.
- On the current single free web instance, the worker runs alongside the web process and resumes pending work after a restart/wake. For sustained high-volume institutional use, deploy a dedicated Render background worker and scale it independently.
- If a chunk fails, VERITY records the failed chunk and error summary; an administrator should correct the source data or investigate the failure before starting a corrected batch.

**Important safeguards**

- The maximum CSV file size is 5 MB and one file may contain up to 50,000 data rows.
- Student numbers are normalized and unique within the institution. Existing institution/student-number pairs are skipped; existing roster details are not silently overwritten.
- If a connection is interrupted, upload the same corrected file again. Existing records are skipped rather than duplicated.
- A roster entry is not a Verity authentication account, a certificate, or a grant to view a private certificate document.
- Graduates create their own accounts and use the existing institution-link request and approval workflow.
- The roster directory currently displays the latest 100 records; use the search field to filter those loaded records.

### 5.3 Assign staff permissions

An organization owner can assign limited access to existing VERITY accounts.

1. Ask the staff member to create and verify their own account.
2. Open **Staff**.
3. Enter the exact email address used by the staff member's VERITY account.
4. Select only the permissions required for their job:
   - `certificates:read` — read certificate records belonging to the institution that assigned the staff member.
   - `documents:download` — download that institution's original certificate documents after the stored file passes its SHA-256 integrity check. This permission also requires `certificates:read`.

Only these two staff permissions are implemented. Staff cannot perform verifier-organization lookups, issue or revoke certificates, approve graduate sharing requests, or administer staff accounts.
5. Add the staff member and confirm that the assignment is active.
6. Suspend or remove access when the person changes role or leaves.

Staff access is restricted to the staff member's own approved academic institution. The database checks the active assignment, the graduate account role, the institution type and approval status, and the requested permission. Suspending the staff assignment or the institution withdraws access. Staff permissions do not grant authority to issue or revoke credentials, approve verifier access, or administer other staff.

### 5.4 Issue a certificate

Only an approved academic organization of type **INSTITUTION** can issue academic credentials. Verify the graduate and award details against the institution's official records before submission.

1. Open **Issue Certificate**.
2. Find or confirm the graduate's approved institution membership.
3. Enter the graduate's legal/official name as recorded by the institution.
4. Enter the student or matriculation number.
5. Enter the institution, faculty, department and programme details requested.
6. Enter the qualification, classification (if applicable) and award date.
7. Upload the official certificate document.
8. Review every field and confirm that the document belongs to the correct graduate and award.
9. Submit the issuance request.
10. Confirm that the credential appears in the institution's certificate list.

On successful issuance, VERITY assigns a unique certificate ID and high-entropy verification key, creates a QR/verification route, calculates a SHA-256 fingerprint from the canonical credential data and automatically appends an **ISSUED** event to the Supabase certificate ledger. The ledger event is linked to the preceding event by a SHA-256 hash. The key and QR are references for subsequent verification; keep them controlled.

**Before issuing:** Search the registry to avoid duplicate records. Correct source records first rather than issuing a second certificate to compensate for a typo.

### 5.5 Review and manage issued certificates

1. Open **Certificates**.
2. Search by graduate or certificate details.
3. Confirm the credential belongs to your institution.
4. Review its status and award information.
5. Use the available QR/verification-link controls to provide the graduate with their reference.
6. Use revocation only when there is a documented reason and the organization has authority over the credential.

### 5.6 Revoke a credential

Revocation is a significant action. It should be used only for a substantiated reason, such as a confirmed erroneous or invalid award.

1. Locate the exact credential.
2. Confirm its certificate ID, graduate and issuing institution.
3. Confirm that you have authority to revoke it.
4. Select **Revoke**.
5. Enter a clear, factual reason when prompted.
6. Submit and confirm the status change.
7. Retain the supporting institutional record according to your institution's policies.

Revocation changes credential status; it is not a normal editing tool. VERITY automatically appends a **REVOKED** event to the Supabase certificate ledger when the status changes to REVOKED. If non-critical metadata is wrong, contact the institution's records administrator/VERITY support for the supported correction process. Do not issue a replacement until the duplicate/replacement handling is understood.

---

## 6. Employer / verifier organization guide

### 6.1 Organization Credentials

An approved Employer organization is a verifier, not an academic issuer.

1. Sign in to the approved Organization Admin account.
2. Open **Organization Credentials** to review the credentials and verification-related records available to your organization.
3. Use the verification workflow to check the certificate ID or verification key supplied by the graduate.
4. Record the outcome through the application workflow rather than relying on screenshots or forwarded claims.

### 6.2 Verify a credential

1. Open **Verify Credentials**.
2. Enter the certificate ID or verification key exactly as supplied.
3. Submit the verification request.
4. Review the result and the credential details returned.
5. Compare the graduate name, institution, programme/qualification and award details with the information supplied by the applicant.
6. Check whether the credential is active or revoked.
7. If the result is not found, do not assume the credential is genuine; confirm the reference with the graduate or issuing institution.

When an approved verifier organization performs a lookup, VERITY attributes the verification request to that organization and records relevant activity where configured. Institution staff can read their institution's credential records only with `certificates:read`; staff do not receive verifier-organization lookup permission.

### 6.3 Request access to the original document

A successful credential lookup does not automatically reveal the private original certificate document.

1. Complete the credential lookup.
2. If the original document is necessary for your process, use the document/access request control.
3. Wait for the graduate to review and approve the request.
4. After approval, access the document only through the authorized VERITY flow.
5. Use or download it only for the stated verification purpose and within the consent period.

Graduate consent is time-limited to **30 days**. The file must also pass its SHA-256 integrity check before it can be served.

### 6.4 Verify responsibly

- A registry match does not prove the person presenting the credential is its rightful holder.
- Compare the returned credential details with the applicant's identity and supporting records.
- Check revocation status at the time of decision.
- Do not treat a screenshot, QR image or old verification result as a current verification.
- Do not share a graduate's private document outside the authorized purpose.
- Escalate mismatched, revoked or suspicious records to the issuing institution and your organization's compliance team.

---

## 7. VERITY System Administrator guide

System Administrator access is highly privileged. Use a dedicated account, protect its credentials and perform administrative actions only for a legitimate platform purpose.

### 7.1 Overview

1. Open **Overview** after signing in.
2. Review total, active and revoked credential counts and verification activity.
3. Review recent credential activity.
4. Use **Refresh now** to request updated dashboard data.
5. Treat displayed totals as current snapshots, not permanent reports.

A Supabase ledger entry is a real database record, not a public blockchain transaction. The active ledger records certificate issuance and revocation events. It does not currently record every certificate metadata edit, page view or user action; relevant operational actions may instead appear in Audit Activity.

### 7.2 Review organizations

1. Open **Organizations**.
2. Filter the queue by all applications, institutions or business/verifier organizations.
3. Open an application and inspect the submitted identity details.
4. Open the supporting evidence using **Review document**.
5. Record the checks and rationale in **Reviewer notes**.
6. Approve only when the evidence supports the organization's identity and type.
7. Suspend an approved organization if a documented concern requires it.
8. Reinstate only after the concern is resolved and evidence is rechecked.

Do not approve an organization based on its name, email address or website alone. The current process is a human evidence review, not automated accreditation verification.

### 7.3 Review all certificates

1. Open **All Certificates**.
2. Search by graduate, certificate ID, institution or programme.
3. Review the issuing organization, award details and current status.
4. Use **Preview file** only where a private document is available to your role.
5. Revoke only when there is a documented reason and the server authorizes the action.

System-wide visibility does not mean the administrator should bypass privacy or consent expectations.

### 7.4 Audit Activity

1. Open **Audit Activity**.
2. Review the action, actor, entity and timestamp together.
3. Compare related events to reconstruct a workflow.
4. Record investigation findings in the approved incident-management process outside the audit log.

Audit entries are generated by server-side workflows. Not every page view or user interaction is necessarily recorded. An audit event is not itself a blockchain transaction.

### 7.5 System Health

1. Open **System Health**.
2. Review the application/API and database configuration indicators.
3. Review whether optional EVM blockchain configuration is available.
4. If a service is unavailable, inspect deployment configuration and hosting logs using the authorized operations process.

The health endpoint reports the document-security configuration, including private storage, SHA-256 integrity checks and the fact that antivirus scanning is not used. Application startup logs also identify the Supabase append-only SHA-256 certificate ledger. Optional EVM blockchain integration remains disabled.

### 7.6 Account Settings

Use **Account Settings** to update the administrator display name where available. This does not change the login email or password. Use the authentication provider's supported account-recovery/settings flow for credentials.

### 7.7 Marketing showcase export

The in-app VERITY film is a 90-second, nine-scene product showcase. The administrator-only MP4 export endpoint renders a video using available platform statistics, a recent credential reference and audit/verification status. Sensitive certificate references are masked in the exported video.

The showcase is a cinematic data-driven presentation, not a screen recording of every live user interaction. Do not publish an export containing confidential information without reviewing the output and obtaining the appropriate authorization. MP4 generation and playback should be verified in the target deployment before the feature is described as operational.

---


## 7.8 Supabase certificate ledger and integrity checks

VERITY currently uses Supabase as its active system of record. The certificate ledger is stored in the Supabase PostgreSQL database; it is not a simulated in-memory list and does not require a wallet, gas, RPC endpoint or smart contract.

### What the ledger records

- **ISSUED:** automatically appended when a certificate record is created.
- **REVOKED:** automatically appended when a certificate status changes to REVOKED.
- Each event stores the certificate reference, relevant event data, the previous entry hash and its own SHA-256 hash.
- Existing certificate records were backfilled into the ledger when it was introduced.

The ledger is append-only for normal application roles. Database triggers reject ordinary update and delete attempts against ledger entries. Privileged database operators remain part of the platform's trusted computing boundary.

### How verification uses it

The public certificate verification endpoint checks the ledger hash chain and confirms that the certificate has at least one corresponding ledger event. A valid active certificate must also pass the credential status and any applicable optional blockchain check. A failed ledger integrity check must not be presented as a successful verification.

The hash chain is a tamper-evidence mechanism within the database. It does not make the database immutable against a sufficiently privileged database operator, and it is not equivalent to independent public blockchain consensus.

### Current limitations

- The ledger currently records issuance and revocation events, not every edit to certificate metadata.
- The ledger does not store student names, student numbers or original certificate documents as event payloads.
- A ledger entry is not a Polygon transaction and does not have a blockchain transaction hash.
- Polygon/EVM anchoring is an optional future enhancement and remains disabled. Do not tell users that a certificate has been anchored on-chain unless a real transaction has been submitted and independently verified.

## 8. Credential lifecycle — end-to-end

The following sequence describes the intended operational flow:

1. **Organization application:** institution registers and submits identity evidence.
2. **Institution approval:** VERITY System Administrator reviews and approves the institution.
3. **Graduate onboarding:** institution shares its registration code; graduate registers and requests membership.
4. **Membership approval:** institution checks official records and approves the graduate.
5. **Award confirmation:** institution confirms the qualification and award data.
6. **Credential issuance:** institution submits the certificate data and original document.
7. **Reference and ledger creation:** VERITY assigns the certificate ID and verification key, creates the QR/verification route, computes the SHA-256 fingerprint and automatically records an ISSUED event in the Supabase certificate ledger.
8. **Graduate access:** graduate opens My Credentials and retrieves the credential reference.
9. **Credential sharing:** graduate shares the reference with an intended verifier.
10. **Organization verification:** approved verifier organization submits the reference and reviews the returned registry result.
11. **Optional document request:** verifier requests access to the original document.
12. **Graduate consent:** graduate approves or rejects the request; approval is time-limited to 30 days.
13. **Document access:** an authorized verifier retrieves the document only while graduate consent is approved and unexpired and the stored file passes its SHA-256 integrity check.
14. **Ledger and audit oversight:** issuance and revocation are recorded in the Supabase hash-chained certificate ledger; other relevant server-side activities may appear in Audit Activity.
15. **Revocation, if required:** authorized issuer/admin workflow changes the credential status for a substantiated reason, automatically appending a REVOKED event to the Supabase certificate ledger.

---

## 9. Security, privacy and trust

### 9.1 Authentication and authorization

- VERITY uses Supabase Auth for email/password authentication.
- Authenticated API requests are checked against the user's profile.
- Role checks and organization-scoped checks are enforced on the server.
- Staff access requires an active assignment and the specific permission needed.
- Row Level Security (RLS) is used to scope access to credential and audit data.
- Never expose a Supabase secret key or service-role key in frontend code.

### 9.2 Private documents and integrity verification

Certificate documents and organization identity evidence are stored in private Supabase Storage buckets. VERITY does **not** perform antivirus or malware scanning. Uploads are limited to PDF, JPEG and PNG, checked against their declared file signatures and limited to 10 MB. The backend records a SHA-256 fingerprint when each file is uploaded. Before preview or download, it retrieves the private object and compares its actual SHA-256 digest with the stored fingerprint. A missing or mismatched fingerprint blocks release.

This integrity check detects a file changing after its fingerprint was recorded; it is not a malware detector and does not prove that an uploaded file is safe. Users should upload documents only from trusted sources and keep their own devices protected. Private storage, authenticated roles, institution scoping, staff permissions and graduate-controlled access grants continue to govern who can retrieve a document.

**Production database step:** ensure the migration `supabase/migrations/20261121120000_remove_antivirus_scan_gates.sql` has been applied in the Supabase SQL Editor before relying on the current document-access policies. It removes obsolete antivirus-verdict predicates while preserving private-bucket enforcement, certificate-to-institution relationships, storage-path tenant checks, administrator and institution ownership checks, active staff permission checks, and approved, unexpired employer grants. This is a one-time policy migration, not an antivirus setup step. Never make either bucket public.

### 9.3 Blockchain and the database ledger

VERITY supports optional EVM integration through the Solidity contract in `contracts/CertificateRegistry.sol`.

The chain integration requires deployment configuration for:

- `CHAIN_RPC_URL`
- `CHAIN_PRIVATE_KEY`
- `CONTRACT_ADDRESS`

When those settings are absent, VERITY continues operating with its **active Supabase PostgreSQL certificate ledger**. This is the production database-backed system of record, not a demo or simulated in-memory ledger. It is not a public blockchain transaction. Describe a credential as blockchain-anchored only when the configured network and contract confirm the transaction and a transaction reference can be independently inspected.

### 9.4 Personal data

- Do not place student names, student numbers, email addresses or original certificate documents on a public blockchain.
- Share only the minimum credential reference needed for verification.
- Do not disclose private documents or audit details to unauthorized parties.
- Follow applicable institutional retention, privacy and data-protection policies.

### 9.5 Integrity and limitations

The SHA-256 fingerprint is calculated from canonical credential fields. It supports integrity checks; it does not independently prove that the original award was academically valid. Trust still depends on the issuer's identity, evidence review, correct data entry, authorization and the verification process.

VERITY is a software system and does not by itself confer government recognition, accreditation, legal equivalence or university adoption.

---

## 10. Troubleshooting

| Problem | What to check / do |
|---|---|
| Cannot register | Check required fields, email format and password length. If the email already exists, sign in or use account recovery. |
| Asked to confirm email | Complete confirmation if enabled in the Supabase Auth settings, then sign in again. |
| Profile is not ready | Confirm email if required, wait briefly and sign in again. Contact support if it persists. |
| Organization remains Pending | The application is awaiting human review. Confirm that required identity details and evidence were submitted. |
| Institution cannot issue | Confirm organization type is INSTITUTION, status is APPROVED, the account is the owner or has the required authority, and the graduate membership is approved. |
| Graduate cannot find institution | Check the registration code with the institution and submit a membership request. |
| Membership is pending | The institution must compare the submitted details with its records and approve or reject the request. |
| Staff cannot see records | Confirm the staff assignment is ACTIVE, the correct organization is assigned and `certificates:read` is enabled. |
| Staff cannot verify | Institution staff do not have verifier-organization lookup permission. Use the institution's owner account for issuer-side verification, or use an approved verifier-organization account for external verification. |
| Staff cannot download a document | Confirm the assignment is ACTIVE, the organization is an approved institution, both `certificates:read` and `documents:download` are assigned, and the document has a valid SHA-256 fingerprint. Graduate consent applies to external verifier organizations, not institution staff. |
| Credential not found | Recheck the certificate ID/key for typing errors and ask the issuer to confirm the reference. Do not infer authenticity from a screenshot. |
| Credential is revoked | Contact the issuing institution for clarification. Do not treat the record as active. |
| Original document is unavailable | Check whether the graduate approved access, the 30-day consent is still valid and the stored file passes its SHA-256 integrity check. |
| Upload remains blocked | Check that the file is PDF, JPEG or PNG, is no larger than 10 MB, and has a valid matching file signature. VERITY does not run antivirus scanning. Review the upload error and server logs without assuming a malware verdict. |
| Blockchain shows disabled | The EVM RPC URL, private key or contract address may not be configured. The active Supabase PostgreSQL certificate ledger remains available without EVM blockchain configuration. |
| Dashboard figures look old | Use Refresh now and confirm the API/database is available. |
| Audit event is missing | Confirm the workflow completed successfully; not every page view is recorded. |
| MP4 export fails | Check admin authorization, server logs, FFmpeg availability, writable temporary storage and live database/RPC dependencies. Confirm the generated file plays before distribution. |

Do not send passwords, session tokens, private keys, student documents or verification keys in an ordinary support message.

---

## 11. Administrator deployment reference

This section is for authorized developers and deployment operators, not everyday users.

### 11.1 Required application configuration

The documented Supabase setup uses:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The core application does not require a direct PostgreSQL connection string, Prisma setup, Supabase secret key or service-role key for ordinary authenticated document uploads, previews or downloads. Do not configure scanner-specific environment variables. Keep any separately required server credentials in the deployment platform's protected settings, never in committed source code or browser code.

### 11.2 Optional blockchain configuration

Configure `CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY` and `CONTRACT_ADDRESS` only when an EVM deployment is ready. Protect the signing key as a production secret. Confirm the deployed contract address and network before enabling user-facing on-chain claims.

### 11.3 Document security configuration

VERITY has no antivirus scanner and requires no ClamAV host, antivirus service or scanner credentials. Confirm the two storage buckets remain private, the server's Supabase URL and publishable key are configured, and the `20261121120000_remove_antivirus_scan_gates.sql` policy migration has been applied. The `/api/health` endpoint reports private-storage and SHA-256 controls. File-signature validation and SHA-256 integrity checks are not malware detection. Do not set public bucket access to work around a policy issue.

### 11.4 Local development

1. Install Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Set the Supabase project URL and publishable key.
4. Run `docker compose up --build`.
5. Open `http://localhost:8080`.

For frontend/backend development without Docker, run `npm install` and `npm run dev`.

### 11.5 Release checklist

Before calling a deployment production-ready, verify all of the following in the target environment:

- [ ] Supabase Auth signup, email confirmation behavior and login.
- [ ] RLS policies and role/organization authorization with separate test accounts.
- [ ] Institution evidence upload, review, approval and suspension.
- [ ] Graduate membership request and institution approval/rejection.
- [ ] Certificate issuance, unique references, QR route and fingerprint.
- [ ] Credential verification for valid, unknown and revoked records.
- [ ] Graduate consent approval, rejection and expiry.
- [ ] Private document access with SHA-256 verification, tenant scoping and graduate consent.
- [ ] Staff permission boundaries and audit events.
- [ ] EVM issue/verify/revoke on a test network, if blockchain mode is enabled.
- [ ] MP4 export authorization, successful rendering and playback.
- [ ] Backups, monitoring, rate limits, error handling and incident response.
- [ ] Privacy, legal and institutional review for the deployment jurisdiction.

A successful frontend build, automated test suite or Docker image build is useful evidence, but does not replace live integration, security and operational testing.

---

## 12. Glossary

- **ADMIN:** VERITY platform-level administrator.
- **Organization Admin:** owner/administrator of an institution or verifier organization; represented by the EMPLOYER application role.
- **GRADUATE:** individual account for a student/graduate.
- **INSTITUTION:** approved academic organization allowed to issue credentials.
- **EMPLOYER:** approved verifier organization that can check credentials but cannot issue them.
- **RLS:** Row Level Security, which restricts which database rows a user can access.
- **EVM:** Ethereum Virtual Machine-compatible blockchain environment.
- **SHA-256:** cryptographic hash function used for the credential fingerprint.
- **SHA-256:** cryptographic digest used to detect whether a stored document differs from the file fingerprint recorded at upload. It is not antivirus scanning.
- **Fail-closed:** deny access when a required security check cannot be completed.

---

**Documentation status:** This guide describes the currently documented product behavior and known deployment caveats. Update it whenever a screen, permission, API workflow, database policy, environment variable or deployment dependency changes. Verify behavior in a running environment before treating a documented workflow as production-tested.
