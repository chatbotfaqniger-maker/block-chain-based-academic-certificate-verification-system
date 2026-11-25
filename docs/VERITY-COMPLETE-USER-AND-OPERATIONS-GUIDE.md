# VERITY — Complete User and Operations Guide

**Product:** VERITY Academic Credential Network  
**Purpose:** Issue, manage, share and verify academic credentials with controlled access, an auditable registry and optional EVM blockchain integration.

This guide explains the current application workflows. Screen labels may vary slightly as the interface evolves. Follow the permissions enforced by the server; a visible button is not a substitute for authorization.

---

## Support & Chat Centre — sharing files

1. Open **Support & Chat Centre** from your workspace.
2. Select an existing conversation or start a new one.
3. In the message composer, select the paperclip icon and choose up to five files.
4. Supported file types are JPEG, PNG, WebP, PDF, plain text, Word and Excel documents. Each file can be up to 10 MB.
5. Add a message if needed, then select Send. The files are uploaded to VERITY's private Supabase Storage bucket and attached to that conversation.
6. Select an attachment in the conversation to open its temporary secure link. Links expire after five minutes; open the attachment again from the chat if needed.

**Privacy and safety:** Only the conversation's authorized participants and VERITY Admin can access its attachments. Do not upload passwords, access tokens, private keys, payment card details or unrelated sensitive personal information. Closed conversations do not accept new uploads. File uploads are restricted by file type and size; antivirus scanning is not enabled, so users should only upload files they trust.

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
5. If registering an organization, enter its organization name and select whether it is an **Institution** or **Employer / verifier**. Provide the requested registration details and, if available, the main public-facing city, state / region and country. Do not enter a street address in these public location fields.
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

## Student identity, roster onboarding and ICT recovery policy

VERITY uses a roster-backed, remote-first student onboarding process. Students do not need to visit ICT for routine registration. A matriculation number identifies the official roster record but is not proof of ownership; a separate, private, single-use activation token is required.

**Student registration and activation**
1. During Graduate / Student signup, enter the matriculation number first and select the approved institution that holds the official record.
2. Complete the account details and create a personal password of at least 10 characters.
3. Sign in and open **Join an institution**.
4. Confirm the matriculation number and institution, then enter the single-use activation token supplied by the institution.
5. VERITY atomically checks the roster and token, marks the token as used, links the account to the institution and changes the membership to **ACTIVE**. The official name from the institution's roster becomes the account's authoritative profile name.
6. If the token is invalid, already used, revoked or the record is disputed, the student must contact the institution ICT office. The system does not reveal another student's private roster details.

**Institution and ICT process**
1. An approved institution imports its official student roster using CSV UTF-8. Required columns: `student_number`, `full_name`. Optional columns include `institutional_email`, `faculty`, `department`, `programme`, and `academic_session`.
2. Open **Student identity & ICT** and select **Generate & export activation tokens**. VERITY creates a different high-entropy token for each eligible unclaimed student and downloads a CSV containing the student number, official name and token.
3. Distribute each token only to its matching student through a secure channel controlled by the institution. The export contains raw tokens only once. Store and handle the downloaded file as confidential data; do not email a full roster-token file to an unrestricted mailing list.
4. If an unused token is lost or disclosed, use **Issue / replace token** on that eligible roster record. This replaces the previous token. Do not issue tokens for ACTIVE, DISPUTED or BLOCKED records.
5. Institution owners can appoint ICT officers with the minimum required permissions. All token issuance, imports, activations and dispute intake are auditable.

Institution registration codes do not expire by default. An institution may explicitly enable expiry and configure it. Codes are not passwords or student identity evidence. Rotating a code does not affect existing student memberships. Individual activation tokens are separate from institution invitation codes; they do not expire by default, are stored only as SHA-256 hashes and become unusable after first successful activation or replacement.

**Misclaim and recovery safeguards**
- A student who believes another account has claimed their matriculation number should report it to the institution ICT office.
- Authorized ICT staff check the official student record and open a registration-dispute case. The record is flagged for review.
- An ACTIVE account is never silently detached or transferred. ICT can record a first review and a different authorized officer must provide the second approval before a claimed record can be released. The system blocks this release if the claimant has certificate records for that institution and matriculation number; those cases are escalated to VERITY Admin for manual credential-history review. On successful two-person release, the old institution membership is rejected, the roster record returns to ELIGIBLE, and a fresh one-time activation token is issued. The old account itself is not deleted.
- ICT must never request a student's password or ask them to share their session token. Use institution records and documented identity checks.

Students should not have to visit ICT for routine onboarding. A physical visit is only an institution's fallback when its approved remote identity-checking and token-distribution channels cannot establish the student's identity.

For the current importer, prepare the roster in Excel or another spreadsheet application and save/export it as **CSV UTF-8** before uploading. Required headers are `student_number` and `full_name`; optional headers are `institutional_email`, `faculty`, `department`, `programme`, and `academic_session`. A sample, non-real-data template is available at [VERITY Student Roster Template](VERITY-STUDENT-ROSTER-TEMPLATE.csv). Direct .xlsx workbook upload is not yet supported.

Implementation status (22 November 2026): The first roster-backed signup and single-use activation workflow is deployed with CSV roster import, public approved-institution selection, student matriculation-first signup, one-time hashed activation tokens, atomic roster claiming, ACTIVE membership creation, per-student token replacement for eligible unclaimed records, scoped ICT assignment, and audited registration disputes. Two-person recovery is implemented: a first authorized officer records the review, a different authorized officer must approve completion, and release is blocked when the claimant has certificate records for that student identity so VERITY Admin can review credential ownership. The previous account is not deleted. Direct .xlsx import and full real-account end-to-end testing remain outstanding.


### 2.4 In-app student onboarding walkthrough

The **User Guidelines** module now includes a dedicated **Student registration & institution activation** walkthrough. It explains matriculation-first signup, choosing an approved institution, creating a personal password, signing in, entering the private single-use activation token, and contacting institution ICT when a record is missing or already claimed. The institution-side **Student identity & ICT** guide covers roster import, token generation and secure distribution, ICT permissions, and two-person dispute recovery.

This is an in-app interactive written walkthrough. It does not mean the previously completed cinematic VERITY documentary MP4 has been re-edited or replaced; a separate narrated screen-recording/video segment would be a distinct media deliverable.

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

### 3.3 Public organization directory and location details

The **Registered organizations** area lets signed-in users discover approved institutions and verifier organizations that have chosen to appear publicly.

- Search by organization name and filter by organization type.
- Use the location filter to match the city, state / region or country supplied by an organization.
- Directory cards show only the public legal identity fields and the organization-reported location. VERITY does not present these location entries as independently verified.
- Only approved organizations with directory visibility enabled are listed. An organization can hide itself without losing its VERITY registration or affecting direct certificate verification.
- An approved organization owner can update the public location fields from the Organization Identity area. Legal identity changes remain subject to a new VERITY review.
- The directory does not publish street addresses or private contact details. Always use the certificate verification link or code to verify an individual credential; directory listing alone does not prove certificate validity.

### 3.4 VERITY review

A System Administrator reviews the organization details and evidence. The decision is a manual review; the current workflow does not claim automated verification against government or regulator databases.

Possible outcomes include:

- **PENDING:** waiting for review or further action.
- **APPROVED:** approved services become available according to the organization's type.
- **SUSPENDED:** organization services are blocked while the suspension is in effect.

Do not repeatedly submit duplicate applications while a review is pending. If clarification is requested, provide the requested information through the official support or application process.

### 3.5 What approval enables

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

### 5.3 Assign staff permissions

An organization owner can assign limited access to existing VERITY accounts.

1. Ask the staff member to create and verify their own account.
2. Open **Staff**.
3. Enter the exact email address used by the staff member's VERITY account.
4. Select only the permissions required for their job. New assignments default to read-only:
   - `certificates:read` — read certificate records and associated document details belonging to the institution that assigned the staff member. This does not expose the private file itself.
   - `documents:download` — retrieve that institution's original certificate files after the stored file passes its SHA-256 integrity check. This permission also requires `certificates:read`.

Only these two staff permissions are implemented. Staff cannot perform verifier-organization lookups, issue or revoke certificates, approve graduate sharing requests, or administer staff accounts.
5. Add the staff member and confirm that the assignment is active. New assignments begin with read-only access; enable document downloads only when the role requires original files.
6. Use **Edit permissions** to change an existing staff member's access. Removing certificate-read access also removes document-download access automatically.
7. Suspend or reactivate an assignment when the person's role changes. Suspend access promptly when the person leaves.

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

The in-app VERITY film is a 120-second (two-minute), nine-scene product showcase. The extended runtime gives the film room to explain student identity registration and ICT recovery, roster import and reviewed bulk issuance, organization registration and directory discovery, and the Supabase append-only SHA-256 certificate ledger. The administrator-only MP4 export endpoint renders a video using available platform statistics, a recent credential reference and audit/verification status. Sensitive certificate references are masked in the exported video.

The showcase is a cinematic data-driven presentation, not a screen recording of every live user interaction. Do not publish an export containing confidential information without reviewing the output and obtaining the appropriate authorization. The interactive in-app film and administrator MP4 export are both designed for a 120-second runtime. MP4 generation, exact duration and playback should be verified in the target deployment before the feature is described as operational.

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


## Certificate lifecycle consistency

VERITY uses Supabase as the authoritative certificate system of record. Certificate issuance inserts the credential into the database; a PostgreSQL trigger appends the `ISSUED` event to the hash-chained `CertificateLedger` in the same database transaction. A status change to `REVOKED` similarly appends a `REVOKED` event in the same transaction as the status update.

Optional Polygon Amoy anchoring is a secondary integration. When enabled, a blockchain transaction is attempted after the authoritative Supabase issuance or revocation has committed. If the optional chain operation fails, the Supabase credential and database ledger remain authoritative; the API reports that the blockchain anchor is pending rather than pretending that the blockchain transaction succeeded. Do not describe a Supabase ledger event as an on-chain transaction.

Only the approved issuing institution may revoke its own credentials. Platform administrators may perform platform-level revocation. Verification organizations cannot issue or revoke credentials belonging to institutions.

A verifier's private-document access is separate from public credential verification. An approved verification organization requests access; the linked graduate approves or rejects it; an approval expires after 30 days and can be revoked by the graduate at any time. Revocation is recorded with its timestamp and actor, immediately blocks subsequent preview and download requests, and notifies the organization owner. Rejected, revoked and expired requests remain in the access history; an organization may submit a fresh request after a prior decision or expiry, while only one pending request per certificate and organization is allowed. Organization previews are streamed through an authenticated, non-cacheable in-app endpoint rather than exposing a reusable signed file URL. The verifier must still pass organization scope, active-certificate and document-integrity checks to view or download the original file. Public verification does not reveal the private original document.

The Admin audit timeline records application actions such as issuance, revocation, access requests and consent decisions. The append-only certificate ledger is a separate integrity history for certificate issuance and revocation. These two records serve different purposes and must not be described as interchangeable.


---

## Issue Resolution Centre

The Issue Resolution Centre is available from every signed-in workspace.

### Submit an issue
1. Open **Issue Resolution Centre** from the workspace navigation.
2. Select the closest issue category and impact level.
3. Enter a short title and describe what happened, what you expected and any visible error message.
4. Do not include passwords, session tokens, private keys or confidential identity documents.
5. Submit the report and keep its VERITY ticket reference.

### Track and manage reports
- Graduates and other individual users can view the reports they submitted.
- An institution owner can view reports associated with that institution and update their workflow status.
- VERITY System Administrators can review platform-wide reports and update their workflow status.
- Status changes are recorded as audit events.
- A resolved status means the report has been marked resolved; it is not proof of an automatic repair unless the responsible operator has verified the result.

### Current capability boundary
The first release provides ticket submission, tenant-scoped visibility, status tracking and audit history. It does not yet provide automated root-cause diagnosis, repair scripts, ticket attachments, comments, or automatic retry buttons. Infrastructure-level and privileged repairs remain System Administrator responsibilities. Never change the certificate ledger or audit history to resolve a user support ticket.


### Direct support chat

The Issue Resolution Centre includes a private conversation thread for each support report.
- Organization and institution owners can open a conversation with VERITY Admin from their dashboard.
- VERITY Admin can review conversations across the platform and reply from the Admin workspace.
- Messages appear in chronological order and refresh automatically while the conversation is open.
- Conversation access is restricted to the report's submitter, the owning organization and VERITY Admin.
- Closed conversations are read-only. A new support request can be opened if further help is needed.
- The inbox supports search and status filters. Status changes are audited.

The current chat release uses periodic refresh for new messages; it is not advertised as a guaranteed instant-delivery or staffed 24/7 live-chat service.


## Browser notifications and platform announcements

Users and administrators can opt in to browser notifications from Support & Communication Centre. The browser must support Push API, the site must be served over HTTPS, and the user must grant notification permission. Notifications are sent for new support replies. Users can revoke permission from browser/site settings. VERITY administrators can assign a conversation to a registered administrator, review unread-message counts, and send a platform-wide email announcement from the Admin workspace. Broadcasts are sent to registered profile email addresses and are recorded in audit activity. Email sending requires an SMTP sender configured by the platform operator. Background push requires VAPID keys and a server-only Supabase service key. Until those secrets are configured and tested, the relevant delivery channel is not active; the interface must not be interpreted as proof of delivery.


## Notification Centre (all roles)

Open Notifications in the main workspace navigation to review recent account and platform activity. The Centre includes unread counts, mark-as-read actions, browser push opt-in, and preferences for in-app and browser notifications by category. Notifications can cover organization registration and approval, certificate issuance and revocation, graduate consent and document access requests, support conversations, and platform announcements. Push requires a supported browser, HTTPS, and permission. If notifications are not arriving, check browser site permissions and contact VERITY Admin. Email announcements sent by Admin are a separate broadcast channel; personal transactional email preferences are stored but transactional email delivery is not currently enabled by this feature.


## Bulk student roster import

Approved institution owners and active ICT staff with the `roster:manage` permission can open **Bulk student import** from the institution workspace.

1. Download the VERITY student CSV template.
2. Complete the required columns: student number, full name, faculty, department, programme and qualification. Email, classification, award date and academic session are optional.
3. Select the CSV and review the local preview and rejected-row messages.
4. Import the valid records. VERITY stages them in 100-row chunks and shows the upload progress.
5. Review Import history for queued, processing, completed or partial outcomes. The batch shows inserted, duplicate, rejected and failed counts.
6. Open Institution ICT Centre to review the student roster and use the existing activation-token workflow.

Bulk import adds eligible records to the existing student identity registry. It does not create login accounts, issue certificates, or grant access to private documents. Existing institution/matriculation records are never overwritten; duplicate normalized student numbers are skipped. If an upload is interrupted while the same page remains open, use **Resume interrupted upload** to retry the missing chunks. The server-side worker runs within the existing Render web service and requires a server-only Supabase service key plus `ENABLE_STUDENT_IMPORT_WORKER=true`. Without that configuration, submitted batches remain safely queued.

ICT staff can use Bulk student import only when their active institution assignment includes `roster:manage`. Staff with only `registration:recover` can use the recovery workflow but cannot import or browse the full roster. The institution owner remains responsible for assigning and reviewing ICT permissions.


## Certificate design and existing-certificate digitisation

VERITY supports three document paths for approved academic institutions. These paths share the same certificate registry and verification infrastructure; they do not create separate verification systems.

### A. Institution original certificate design
- Upload the institution's approved certificate artwork once, rather than uploading the same background for every graduate.
- Configure the supported dynamic fields (graduate name, student number, qualification, programme, faculty, department, classification, award date, certificate reference and QR code).
- Keep the original artwork in private institution-scoped storage. VERITY fingerprints the uploaded asset and uses it as the rendering background.
- The institution must confirm that it owns or is authorized to use the artwork and that the final layout follows its applicable academic and regulatory requirements.

### B. VERITY professional templates
- Choose a built-in VERITY layout when the institution does not have a digital artwork file or prefers a standard layout.
- Configure permitted institution identity elements, such as its name, logo, colours, seal and signatory labels.
- Preview the result before making the template the institution's default for future issuance.
- A template update applies to future certificates only. Previously issued files are not silently regenerated.

### C. Existing certificate digitisation
- Submit an already-issued certificate PDF or image together with the graduate's full name, matriculation number, faculty, department, programme, qualification and award date.
- VERITY stores the source scan privately and calculates its SHA-256 fingerprint. The original file is retained; conversion never overwrites or deletes it.
- The case remains pending until an authorized officer of the issuing institution checks it against official student and award records. The officer records an explicit approval or rejection.
- Only an APPROVED case can be converted. The institution then selects **Convert to VERITY credential** in the review queue. VERITY rechecks the source file's actual type, size and SHA-256 fingerprint before conversion.
- Conversion creates a normal ACTIVE certificate record with its own certificate ID, verification key and canonical SHA-256 digest. The existing database certificate-insert trigger appends the ledger event in the same database transaction that marks the historical case ISSUED.
- The original historical scan is attached to the new credential as private evidence with its original filename, MIME type and SHA-256 fingerprint. It is not represented as a newly rendered VERITY certificate.
- Conversion is idempotent: retrying an already-issued case returns its existing credential and does not create another certificate or ledger event. A pending or rejected scan cannot be converted.
- VERITY must never infer authenticity from a QR code printed on an uploaded scan, a file name, or a visual resemblance to an institutional template.

### Scale and bulk operations
The institution's design is stored once and reused. Each graduate has an individual structured certificate record, unique certificate ID, verification key, QR code, SHA-256 digest and ledger event. Bulk issuance is limited to 8,000 reserved certificate records per institution per UTC calendar month across all campaigns; each campaign can contain up to 8,000 records. VERITY automatically splits campaigns into durable processing batches of up to 500 records each. The monthly allowance is enforced atomically in PostgreSQL and cannot be bypassed by creating multiple campaigns. Student identity and editable certificate fields remain structured PostgreSQL records; private Storage buckets retain certificate PDFs and institution artwork, mapped to their existing student/certificate records. A document image is an optional presentation/evidence file, not the primary database record.

### Verification rule
Scanning a QR code resolves the credential reference. VERITY then checks the issuer, registry record, credential digest/ledger integrity and revocation status. The QR code is only a lookup route; it is not the authenticity proof. Transcript/result verification is a separate credential type and must not be implied by certificate verification.

**Implementation status:** the feature branch contains the design studio, approved-template rendering, editable CSV/XLSX bulk import and atomic approved-case conversion with retained source evidence. The conversion database RPC is restricted to the service role and is covered by PostgreSQL CI assertions for approved-only conversion, ledger creation, idempotency and execution privileges. These changes remain unmerged and undeployed until the stacked pull requests and full end-to-end validation are approved.


### PDF certificate preview (development rollout)
Approved institution owners can generate a private PDF preview from a saved design in the Certificate Design Studio. The preview uses sample or entered graduate details and includes a visible **PREVIEW — NOT A VALID CREDENTIAL** marking and a non-verifying preview QR. It is for layout inspection only: it does not create a certificate ID, verification key, ledger event or public verification result. The original artwork remains private and its stored SHA-256 fingerprint is checked before rendering. Do not distribute preview PDFs as issued certificates.


## Institutional record approval and immutable certificate protection

### CSV / Excel roster import approval

1. Authorized ICT or the Institution Owner selects the official CSV template and uploads the institution's roster.
2. VERITY validates required columns, student numbers, dates and duplicate rows, then stages the data in durable chunks.
3. The uploader submits the completed batch for Institution Owner approval. The batch status becomes **Awaiting approval**.
4. **No student records are inserted or linked to accounts before approval.** Uploading or submitting is not approval.
5. The Institution Owner reviews the batch details and selects **Approve import**. ICT officers cannot approve their own upload.
6. Only after owner approval does VERITY queue the batch for background processing. Existing institution/student-number matches are skipped; existing student records are never silently overwritten.
7. The import history records the uploader, approver, approval time, processing state and row-level outcomes.

### Student Directory correction

1. ICT finds the student's record and selects **Request correction**.
2. ICT enters the proposed values and a reason supported by official institutional evidence.
3. The current directory record remains unchanged while the request is pending.
4. The Institution Owner compares the original and proposed values and approves or rejects the request.
5. If approved, VERITY updates the Student Directory record only. The action and decision are audited.
6. If the source record changed after the request was created, VERITY marks the request as a conflict; ICT must review the current data and submit a fresh request.
7. A claimed student's number cannot be changed through a normal profile correction. Use the existing identity dispute and recovery workflow.

### Issued certificate correction — no editing

**An issued certificate is permanently immutable.** No role, including the Institution Owner or VERITY System Administrator, can edit its academic contents, certificate ID, verification key, original document or SHA-256 fingerprint. A Student Directory correction never changes a previously issued certificate.

If an issued credential contains an error:

1. Submit a separate credential-correction request linked to the original certificate ID and digest.
2. Provide the proposed corrected values and a clear reason.
3. The Institution Owner approves or rejects the request.
4. Approval authorizes a **new certificate issuance** through the normal issuance workflow. The new credential receives a new certificate ID, verification key, issuance timestamp and fingerprint.
5. The original certificate remains unchanged. If it should no longer be relied upon, revoke it separately with a meaningful reason. Its historical record and verification outcome remain auditable.

Approval does not automatically edit, revoke or replace the original credential.

### Fifteen-clip video guide

The User Guide video sequence must contain 15 separately navigable clips, each at least five seconds long. The clip-by-clip storyboard, screen actions and narration are maintained in [VERITY Record Integrity & Approval Policy](VERITY-RECORD-INTEGRITY-AND-APPROVAL-POLICY.md). Clips must show the real application states and must never depict a certificate Edit action.
