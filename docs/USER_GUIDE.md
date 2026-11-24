# VERITY User Guide

## Institution module

### Bulk student registration
1. Sign in as an approved institution owner or an ICT staff member with the required roster permission.
2. Download the VERITY student CSV template.
3. Complete student details and import the CSV.
4. Review validation results, duplicate matriculation numbers and rejected rows.
5. Submit the batch. VERITY processes it through the durable roster queue and records progress in import history.
6. Newly registered students enter the existing eligible state. Student accounts and activation tokens are not created automatically.

### Bulk certificate issuance
1. Sign in as the approved institution owner. Bulk certificate issuance is not available to verification-only organizations or ICT roster staff.
2. Download the official VERITY CSV template and complete student number, full name, faculty, department, programme, qualification and award date. Award date is required in YYYY-MM-DD format. Export Excel workbooks as CSV UTF-8.
3. Choose one of the three methods:
   - CSV + ZIP of PDFs: upload one ZIP containing individual PDF certificates.
   - CSV + multiple PDFs: select the individual PDF files together.
   - Generate from template: let VERITY create an individual PDF from each row. The institution must add its authorized signature/seal before treating the generated template as an official original.
4. For existing PDFs, name each file using the student's matriculation number, such as 2021-CS-001.pdf. VERITY matches by normalized student number, not by student name.
5. Review every row and resolve invalid data, duplicate student numbers, missing files and ambiguous PDF matches. A batch supports up to 500 students; CSV maximum 5 MB; ZIP maximum 250 MB; each PDF maximum 10 MB.
6. Confirm that you authorize issuance for the institution. VERITY privately stages the PDFs, validates their PDF signature and SHA-256 fingerprints, and submits the batch to the durable queue.
7. Once the batch is successfully queued, the server-side worker continues processing even if you close the page. Reopen Bulk certificate issuance to review batch history and issued, failed, queued, processing and document-failure counts.
8. If staging is interrupted before submission, resume the same pending batch. Do not start a second batch for the same rows. If an item requires review after a worker interruption, VERITY checks the certificate ledger before recovery and will not blindly reissue an uncertain certificate.

### Certificate issuance security
- Each certificate is written to the existing Supabase certificate ledger and follows the standard integrity and audit workflow.
- Bulk issuance does not create per-certificate blockchain transactions.
- PDF files remain in private storage. SHA-256 checks detect changes; antivirus scanning is not performed.
- A document failure after certificate creation is reported separately so the certificate is not issued again.

## Graduate module
- Review credentials issued by your institution.
- Control access requests and revoke active grants where appropriate.
- Share credentials only with organizations you trust.

## Organization module
- Register and maintain accurate legal identity information.
- Request graduate consent before accessing private credential documents.
- Verify credentials and retain the verification outcome for your audit workflow.

## Admin module
- Review institutional registrations, platform activity and system health.
- Use privileged account and audit controls only within the assigned administrative permissions.

## Staff module
- Staff capabilities depend on the permissions granted by the institution owner.
- Student roster permissions do not automatically grant certificate issuance or document access.
