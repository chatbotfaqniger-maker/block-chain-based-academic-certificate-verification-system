# VERITY User Guide

## Organization identity and service permissions

1. During institution registration, choose the education levels served by the organization. A school that operates both primary and secondary sections should select **Primary** and **Secondary** together under the same organization account. Universities and colleges can retain **Tertiary**.
2. After signing in, open **Organization identity** and complete the organization's legal identity details and supporting evidence. Tertiary institutions must provide a registration number, official website and accreditation body; primary/secondary schools must provide their school registration number and supervising or accreditation body, while a public website is optional.
3. Open **Organization service permissions** to review the separate **Issue credentials** and **Verify credentials** permissions.
4. An organization owner may request either permission or both, but cannot approve a request. A VERITY administrator reviews each request independently.
5. Organization identity approval is required before a requested capability can be approved. Requesting a permission does not activate it.
6. Existing university issuance, verifier-only access, certificate templates, uploaded PDF/image artwork, editable student-specific fields, storage buckets and bulk issuance methods remain on their existing workflows.

The capability expansion is being introduced in stages. Until all backend, roster, template, issuance and verification integrations have passed regression testing and the release is deployed, only the existing approved institution and verifier workflows are operational. Do not treat a pending capability request as permission to issue or verify credentials.

## Institution module

### Bulk student registration
1. Sign in as an approved institution owner or an ICT staff member with the required roster permission.
2. Download the VERITY student CSV template.
3. Complete student details and import the CSV.
4. Review validation results, duplicate matriculation numbers and rejected rows.
5. Submit the batch. VERITY processes it through the durable roster queue and records progress in import history.
6. Newly registered students enter the existing eligible state. Student accounts and activation tokens are not created automatically.

### Bulk certificate issuance
1. Sign in as the approved credential-issuer owner. Bulk certificate issuance is not available to verification-only organizations or ICT roster staff.
2. Download the official VERITY CSV template and complete student number, full name, faculty, department, programme, qualification and award date. Award date is required in YYYY-MM-DD format. Export Excel workbooks as CSV UTF-8.
3. Choose one of the three methods:
   - CSV + ZIP of PDFs: upload one ZIP containing individual PDF certificates.
   - CSV + multiple PDFs: select the individual PDF files together.
   - Generate from template: let VERITY create an individual PDF from each row. The institution must add its authorized signature/seal before treating the generated template as an official original.
4. For existing PDFs, name each file using the student's matriculation number, such as 2021-CS-001.pdf. VERITY matches by normalized student number, not by student name.
5. Review every row and resolve invalid data, duplicate student numbers, missing files and ambiguous PDF matches. One issuance campaign supports up to 50,000 students. VERITY automatically divides it into durable processing batches of up to 500 items; 500 is an internal processing chunk, not the institution's campaign limit. CSV maximum 5 MB; ZIP maximum 250 MB; each PDF maximum 10 MB; selected PDFs together may total up to 250 MB.
6. Confirm that you authorize issuance for the institution. VERITY privately stages the PDFs, validates their PDF signature and SHA-256 fingerprints, and submits the campaign. Its processing batches are allocated safely and queued individually.
7. Once the campaign is submitted, the server-side worker continues processing even if you close the page. Reopen Bulk certificate issuance to review campaign totals and individual processing-batch history, including issued, failed, queued, processing and document-failure counts.
8. If staging is interrupted before submission, resume the same pending campaign while the current page session and selected source files remain available. Do not start a duplicate campaign for the same rows. If an item requires review after a worker interruption, VERITY checks the certificate ledger before recovery and will not blindly reissue an uncertain certificate.

### Student records and document storage
- Student identity, roster details and editable certificate fields remain structured records in Supabase PostgreSQL.
- Existing private Storage buckets continue to hold original certificate PDFs, institution-uploaded artwork and staged documents. Each file remains linked to its existing student, template or certificate record through its storage path and metadata.
- Do not upload student CSV data as a replacement for the relational roster, make certificate buckets public, or create a second certificate-upload/template system. The existing Certificate Design Studio and student-to-document mapping remain authoritative.

### Certificate issuance security
- Each certificate is written to the existing Supabase certificate ledger and follows the standard integrity and audit workflow.
- Bulk issuance does not create per-certificate blockchain transactions.
- PDF files remain in private storage. SHA-256 checks detect changes; antivirus scanning is not performed.
- A document failure after certificate creation is reported separately so the certificate is not issued again.

## Graduate module
- Review credentials issued by your organization.
- Control access requests and revoke active grants where appropriate.
- Share credentials only with organizations you trust.

## Organization module
- Register and maintain accurate legal identity information.
- Request graduate consent before accessing private credential documents.
- Organizations with approved `VERIFY_CREDENTIALS` permission can verify credentials and retain the verification outcome for their audit workflow.

## Admin module
- Review institutional registrations, platform activity and system health.
- Use privileged account and audit controls only within the assigned administrative permissions.

## Staff module
- Staff capabilities depend on the permissions granted by the institution owner.
- Student roster permissions do not automatically grant certificate issuance or external-verification permission. The organization owner must hold the approved `ISSUE_CREDENTIALS` capability.
