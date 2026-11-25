import React, { useState } from "react";
import VerityShowcase from "./Showcase.jsx";
import {
  BookOpen, ShieldCheck, ArrowRight, AlertTriangle, LockKeyhole,
  CheckCircle2, LayoutDashboard, Building2, FileCheck2, Activity,
  Settings, GraduationCap, Users, Plus, Search, Share2, ClipboardCheck, FileSpreadsheet, KeyRound
} from "lucide-react";

const g = (page, title, icon, intro, audience, steps, actions, permissions, warnings, fixes) => ({
  page, title, icon, intro, audience, steps, actions, permissions, warnings, fixes
});

const workspaceOverview = g("overview","Overview",LayoutDashboard,"Your workspace home summarizes the services available to your signed-in role.","Graduate, institution owner, credential issuer or verification organization owner.",
  ["Open Overview after signing in to see the services available to your account.","Review the cards and recent activity shown for your role; these differ between graduates, institutions and verifier organizations.","Use the navigation to open a module, then return to Overview for a workspace summary.","Refresh the page after important actions when you need the latest status."],
  ["Overview cards — summarize the activity available to your role.","Navigation — opens the modules enabled for your account."],
  "Only modules allowed by your account role and organization approval are available. Institution ICT permissions are separately limited to roster:manage and registration:recover; organization verification staff permissions are certificates:read and documents:download.",
  ["Dashboard totals are snapshots and can change after a refresh.","A database-ledger status is not evidence of a live blockchain transaction."],
  ["If a module is missing, check your role and organization approval.","If data does not load, refresh the page and check System Health where available."]);

const adminGuides = [
  g("overview","Overview",LayoutDashboard,"A live summary of credential activity and the platform workspace.","Verity System Administrators.",
    ["Open Overview after signing in. Review total, active and revoked credentials and verification counts.","Review the recent credentials list for the latest registry activity.","Use Refresh now to reload dashboard and certificate data; the page also refreshes periodically."],
    ["Refresh now — requests fresh dashboard and certificate data.","Recent credential row — shows the graduate, qualification, institution and current status."],
    "ADMIN account. This page is read-only; use the dedicated organization and certificate modules for permitted administration.",
    ["Dashboard totals are snapshots and may change after the next refresh.","A database-ledger count is not evidence of an on-chain transaction."],
    ["If statistics do not load, use Refresh now and check System Health.","If access is denied, sign in with the designated administrator account."]),
  g("organizations","Organizations",Building2,"Review institution and business organization applications, identity evidence and approval status.","Verity System Administrators.",
    ["Choose All applications, Institutions or Business organizations to filter the queue.","Open each application and compare the organization details with the submitted supporting evidence.","Use Review document to inspect each evidence file. Record the checks performed in Reviewer notes.","Approve only after evidence review. Suspend an approved organization if a documented concern requires it.","Reinstate a suspended organization only after the issue has been resolved and evidence rechecked."],
    ["All applications / Institutions / Business organizations — filters the application queue.","Review document — opens private supporting evidence in a separate view.","Reviewer notes — records the human review rationale.","Approve — activates the organization’s role-appropriate services; Suspend — blocks those services."],
    "ADMIN only. Approval is a manual System Administrator decision. Evidence must be submitted before the Approve action is enabled.",
    ["Do not approve from the organization name alone.","Institutions can issue academic certificates; employer/verifier organizations can verify but cannot issue.","Keep reviewer notes factual and avoid placing unnecessary personal data in them."],
    ["If approval is disabled, confirm that supporting evidence has been uploaded.","If evidence will not open, retry and check the organization evidence status."]),
  g("certificates","All Certificates",FileCheck2,"Search and inspect credential records across the Verity network.","Verity System Administrators.",
    ["Use the search field to find a record by graduate, certificate ID, institution or programme.","Review the status, award date and issuing institution.","Use Preview file when an original certificate document is available.","Use Revoke only when there is a documented reason and the issuer’s authority has been checked."],
    ["Search credentials — filters the visible registry list.","QR — opens the credential’s QR/link sharing panel when available.","Preview file — opens a private in-app document preview.","Revoke — asks for a reason and submits a revocation request."],
    "ADMIN can inspect platform-wide records. Certificate issuance remains an approved institution responsibility. Revocation is subject to server-side ownership and permission checks.",
    ["Revocation changes the credential’s status and should not be used as a routine edit.","A QR or registry match does not by itself prove the presenter’s identity."],
    ["If a record is missing, clear the search and check the exact certificate ID.","If Preview file is unavailable, the issuer may not have uploaded a document or the file may be missing or unavailable."]),
  g("activity","Audit Activity",Activity,"Review recorded actions for accountability and operational investigation.","Verity System Administrators.",
    ["Open Audit Activity to view the newest recorded events.","Read the action, actor, entity and timestamp together to understand the event.","Compare related events when investigating a workflow and record any follow-up outside the audit log."],
    ["Audit event row — identifies the action, actor, entity and date; this view is a review surface, not an editing tool."],
    "ADMIN only. Audit entries are generated by server-side workflows; do not assume every page view is an auditable event.",
    ["An audit event is not the same as a blockchain transaction.","Do not share audit details containing operational or personal information with unauthorized people."],
    ["If no events appear, refresh the page and confirm that actions have been performed.","If an expected event is absent, verify whether the relevant workflow completed successfully."]),
  g("system","System Health",Activity,"Understand the application, database and optional blockchain status reported by Verity.","Verity System Administrators.",
    ["Open System Health and review the API/database and blockchain indicators.","Check whether an EVM RPC endpoint and contract are configured before describing a credential as on-chain.","Use the reported health details to decide whether the issue belongs to the application, database, RPC provider or contract configuration."],
    ["Health indicators — report the status exposed by the backend; they do not restart or repair services."],
    "ADMIN only. Infrastructure credentials and environment variables must be managed by authorized deployment operators, not entered into user-facing forms.",
    ["The active Supabase PostgreSQL certificate ledger remains the system of record when optional blockchain settings are absent.","Never claim a public-chain transaction unless a transaction hash and network confirmation exist."],
    ["If blockchain is disabled, check CHAIN_RPC_URL, CHAIN_PRIVATE_KEY and CONTRACT_ADDRESS in the deployment environment.","If the API reports an error, inspect the hosting provider’s logs and service health."]),
  g("settings","Account Settings",Settings,"Update the display name shown in the administrator workspace.","Verity System Administrators.",
    ["Open Account Settings and review the current display name.","Edit the name and select Save changes.","Confirm the success message and updated name in the workspace."],
    ["Display name — changes the name displayed in Verity.","Save changes — sends the update to the authenticated profile endpoint."],
    "ADMIN authentication is required. This form does not change the login email or password.",
    ["Use your own professional name and do not share administrator credentials.","Sign out after using a shared device."],
    ["If saving fails, check the name length and retry after reconnecting.","For login email or password changes, use the account provider’s supported recovery/settings flow."])
];

const ictCentreGuide = g("student-identity","Institution ICT Centre",KeyRound,"Manage the organization's student roster, activation tokens and controlled identity-recovery workflow.","Approved institution owner and active ICT staff assigned roster:manage or registration:recover.",
  ["Open Institution ICT Centre to view the organization roster and the permissions assigned to your account.","Search by the exact student or employee number or student name and compare the result with the organization's authoritative student record.","Use Generate & export activation tokens only for eligible, unclaimed student records. Deliver each one-time token privately to its matching student.","Do not issue a replacement token for a claimed, disputed or blocked record. Open the identity-recovery workflow and provide the required first review.","A second authorized officer must complete the independent approval before a recovery token can be issued.","Keep the audit history and protect all exported token files; tokens are credentials, not passwords."],
  ["Student roster — displays institution records and their eligibility/claim status.","Generate & export activation tokens — creates single-use tokens for eligible, unclaimed records and exports the raw values once.","Recovery cases — opens the controlled two-person review process.","ICT assignments — visible only to the organization owner for staff administration."],
  "Institution owners control ICT assignments. ICT users can only use the permissions assigned to them: roster:manage and/or registration:recover. ICT staff cannot administer other ICT staff or issue certificates.",
  ["Tokens do not expire unless the organization explicitly enables an expiry policy. Revoke and reissue only when an unused token is lost or compromised.","Never send a token to a different student or include it in a public message.","A student or employee number alone does not prove ownership of a student record."],
  ["If a student cannot claim a record, compare the normalized student or employee number and institution against the official roster.","If a record is already claimed, disputed or blocked, use identity recovery rather than issuing another activation token.","If a permission is missing, ask the organization owner to review the ICT assignment."]);

const bulkStudentGuide = g("bulk-students","Bulk Student / Employee Import",FileSpreadsheet,"Import large graduate or employee cohorts into the existing VERITY identity registry without creating login accounts or certificates.","Approved credential-issuer owner or active institution ICT staff with roster:manage.",
  ["Download the official VERITY student CSV template.","Export the organization's student roster and fill the required student number, full name, faculty, department, programme and qualification columns. Email, classification, award date and academic session are optional where the organization has accurate values.","Choose the CSV file and review the preview. Correct rejected rows and duplicate student or employee numbers before submitting.","Select Import to stage the file in 100-row chunks. Keep the same file selected if the upload is interrupted and use Resume interrupted upload.","Submit the completed batch for Institution Owner approval. No student records are committed or linked at this stage. The Institution Owner reviews the batch and explicitly selects Approve import; ICT cannot approve its own upload. Only after approval does the batch enter processing. Monitor Import history for final counts.","Use the existing student roster and activation-token workflow to review records and securely deliver activation tokens. Institution owners may also delegate limited ICT duties."],
  ["Download template — provides the supported CSV headers and an example row.","Choose student CSV file — reads a CSV locally and displays validation feedback before submission.","Import / Resume interrupted upload — stages the batch and safely retries incomplete chunks.","Import history — shows batch progress and outcome counts.","Student directory — searches the issuer organization's full roster in pages."],
  "Only an approved credential-issuer owner or an active institution ICT officer with roster:manage can import. Imported rows are created as ELIGIBLE records in the existing StudentRoster registry; they do not create Supabase Auth accounts, issue certificates or grant access to private documents. The background worker requires a server-only Supabase service key and the ENABLE_STUDENT_IMPORT_WORKER setting.",
  ["Student or employee numbers are normalized and unique within an issuer organization. Existing records are never overwritten; duplicate numbers are counted and skipped.","Keep the source CSV and exported student data private. Do not include passwords, national identity numbers or unrelated sensitive information.","A batch can remain QUEUED until the server-side worker is enabled. Do not repeatedly create new batches while an existing batch is processing."],
  ["If required headers are missing, download the template and correct the CSV header names.","If the worker is disabled, ask the deployment operator to configure the server-only service key and enable the worker.","If a batch is partial, inspect rejected/duplicate/failed counts and correct only the affected source rows before a new import."]);

const bulkCertificateGuide = g("bulk-certificates","Bulk Certificate Issuance",FileSpreadsheet,"Issue a reviewed cohort of credentials through VERITY's durable server-side queue.","Approved credential-issuer owner.",
  ["Download the official VERITY CSV template and complete student number, full name, faculty, department, programme, qualification and award date. Award date is mandatory and must use YYYY-MM-DD. Export Excel workbooks as CSV UTF-8.","Choose CSV + ZIP of PDFs, CSV + multiple PDFs, or Generate from template. For existing PDFs, each filename must match the student's normalized student or employee number; VERITY never guesses using student names.","Review all rows and resolve invalid data, duplicate student numbers, missing PDFs and ambiguous file matches. Each batch supports up to 500 students, a 5 MB CSV, a 250 MB ZIP and PDFs up to 10 MB each.","Confirm that you authorize issuance for the organization. VERITY privately stages and fingerprints each PDF, then submits the batch to the durable PostgreSQL queue.","After the batch is successfully queued, the existing Render service continues processing in the background. Reopen Bulk Certificate Issuance to review recent batches and issued, failed, queued, processing and document-failure counts.","If staging is interrupted, resume the same pending batch rather than starting a second one. If a worker lease expires, VERITY checks the certificate ledger before recovery and never blindly reissues an uncertain certificate."],
  ["CSV template — defines the required student and award-date columns.","CSV + ZIP — matches PDF filenames to normalized student numbers.","CSV + multiple PDFs — accepts individually selected PDF files.","Generate from template — creates a PDF per student; the issuer must apply its authorized signature/seal before treating it as an official original.","Batch history — displays persistent processing and result counts."],
  "Credential-issuer owner only. The organization must be APPROVED, hold ISSUE_CREDENTIALS and the durable bulk certificate worker must be enabled. This workflow does not grant ICT roster staff certificate-issuance authority.",
  ["Bulk issuance writes to the existing Supabase certificate ledger and does not send per-certificate blockchain transactions.","Documents remain in private storage and are SHA-256 checked. Antivirus scanning is not performed.","A document failure after certificate creation is reported separately so the certificate is not issued again."],
  ["If the worker is disabled, ask the VERITY deployment administrator to configure the server-only service key and worker flag after the queue migration is deployed.","If a PDF does not match, rename it to the student's student or employee number or select the correct file.","If a batch is interrupted during staging, keep the same selected files and use Resume interrupted batch."]);

const institutionGuides = [
  workspaceOverview,
  ictCentreGuide,
  bulkStudentGuide,
  g("credential-integrity","Record Corrections & Immutable Certificates",ShieldCheck,"Correct institutional directory data through owner approval while preserving every issued certificate exactly as it was issued.","Institution Owner and authorized institution ICT staff.",
    ["Find the student in Student Directory and compare the current values with official institutional evidence.","ICT selects Request correction, enters proposed values and supplies a reason. The current directory record remains unchanged.","The Institution Owner compares original and proposed values, then approves or rejects the request.","After approval, VERITY updates only the Student Directory record and records the decision in the audit history. A claimed student number cannot be changed through this route.","Never edit an issued certificate. Its original academic fields, certificate ID, verification key and fingerprint are permanently locked.","If an issued credential contains an error, submit a separate credential-correction request referencing that certificate and provide proposed corrected values and evidence.","After owner approval, issue a separate replacement certificate through normal issuance. The original remains unchanged and can be separately revoked/superseded with a recorded reason."],
    ["Request correction — submits a proposed directory change; it does not edit the record.","Approve / Reject — Institution Owner-only decision on a pending request.","Credential correction request — creates a separate review record linked to the immutable original certificate.","Normal certificate issuance — creates a new credential with a new certificate ID and fingerprint."],
    "ICT can submit correction requests. Only the Institution Owner can approve or reject. Issued certificate content is immutable for every role, including Institution Owner and VERITY Admin. A corrected credential is a new issuance, never an overwrite.",
    ["Never delete, replace or rewrite an issued certificate PDF or its academic fields.","A directory update does not retroactively alter the certificate snapshot or verification fingerprint.","Approval of a credential correction request does not change the old certificate or automatically issue a replacement."],
    ["If a correction request shows CONFLICT, compare the current record and submit a fresh request.","If a claimed student's number is wrong, use the formal identity dispute/recovery process rather than changing the number in place.","If the original certificate is already revoked, follow the institution's documented reissuance procedure."]),
  bulkCertificateGuide,
  g("identity","Identity",Building2,"Submit official organization identity details and supporting evidence for review.","Institution or credential-issuer organization owner.",
    ["Open Organization Identity and confirm the organization name and current application status.","Enter the official registration number, email domain and accreditation or supervising body. A public website is required for tertiary institutions and optional for primary/secondary schools.","Upload the official registration or accreditation evidence using the evidence form.","Submit the evidence and wait for a Verity System Administrator to review it. Respond to any clarification request."],
    ["Evidence type — labels the kind of official document being submitted.","Choose file — selects the supporting evidence file.","Submit evidence — uploads the file to the private evidence area for manual review."],
    "Organization owner account. The organization must be approved and hold ISSUE_CREDENTIALS before issuing credentials or activating issuer-only services.",
    ["Use official, current evidence and ensure the document belongs to the organization.","Do not upload unrelated student records as institution identity evidence."],
    ["If upload is rejected, check the file type/size and retry with a clear PDF or image.","If status remains Pending, the application is awaiting human review; contact Verity support rather than repeatedly submitting duplicates."]),
  g("students","Students / Employees",GraduationCap,"Review and manage membership requests from graduates or employees who want to link their account to your issuer organization.","Approved credential-issuer owner; institution staff may assist where their existing permissions allow it.",
    ["Share the organization registration code with the intended graduate or employee through a trusted channel.","Open Students / Employees and review pending membership requests.","Check the person's name and student or employee number against the organization's authoritative records.","Approve a matching request or reject an incorrect or unauthorized request.","Contact the graduate if the submitted details need correction before approval."],
    ["Copy code — copies the organization registration code for secure sharing.","Approve — activates the membership link after the organization’s review.","Reject — declines the selected membership request."],
    "Organization owner must be approved to approve membership requests. Graduates create their own Verity accounts and request the link.",
    ["Verify identity and student number before approving.","Treat registration codes as controlled invitations; do not publish them publicly."],
    ["If a student is missing, ask them to register and submit the correct code.","If approval is disabled, confirm the organization is APPROVED and you are signed in as its owner."]),
  g("staff","Staff",Users,"Assign limited, auditable access to existing Verity graduate accounts.","Approved academic institution owner.",
    ["Ask the staff member to create their own Verity graduate account first.","Open Staff and enter the exact email address used by that account.","Assign certificates:read for read-only access to this institution’s credential records.","Add documents:download only when the staff member needs to retrieve original certificate files; this permission requires certificates:read as well.","Select Add staff member and confirm the assignment appears as ACTIVE. Suspend access promptly when duties change or the staff member leaves."],
    ["Staff email — identifies an existing Verity account.","certificates:read — grants read-only access to this institution’s certificate records.","documents:download — allows downloads for this institution when the document passes file-signature and SHA-256 integrity checks.","Add staff member — creates or updates the assignment; Suspend / Reactivate changes active access."],
    "Only an approved academic institution owner can assign staff. Organization staff permissions are certificates:read and documents:download. Institution ICT assignments are a separate permission model for roster:manage and registration:recover. Staff cannot issue or revoke certificates or administer other staff.",
    ["Never share an owner account or grant permissions for convenience.","Only enable document download when required for the staff member’s work."],
    ["If an email is not found, ask the person to register using that exact email.","If a staff member cannot see a module, check their ACTIVE status and assigned permission set."]),
  g("certificates","Certificates",FileCheck2,"Review credentials issued by your organization and manage available certificate records.","Approved credential-issuer owner; existing institution staff access remains read-only and limited to assigned permissions.",
    ["Search for the graduate or certificate before creating another record.","Check the graduate name, student number, programme, qualification and award date against the organization’s authoritative record.","Open the record and inspect its status and available document/QR controls.","Use the record’s QR or verification link to share a credential reference with the graduate."],
    ["Search credentials — filters the visible list.","QR — opens the QR and verification-link panel.","Download — available to the graduate for their own linked document; staff downloads require the assigned permission and valid access.","Revoke — available only to an authorized issuer/owner and requires a reason."],
    "Approved credential-issuer owner can issue/revoke its own records. Staff with certificates:read can inspect assigned organization records; they do not inherit owner privileges.",
    ["Do not create duplicate certificates to correct a record without following the organization’s correction/revocation process.","A document preview or download is blocked when the file is missing or its stored SHA-256 fingerprint is missing or does not match."],
    ["If a certificate is absent, verify that it was issued by this institution and that the student link is correct.","If a file is blocked, check the upload details and SHA-256 integrity status; contact the issuer if the original needs to be uploaded again."]),
  g("issue","Issue Certificate",Plus,"Register an authorized credential award and generate its VERITY reference and QR.","Approved credential-issuer owner only.",
    ["Confirm the graduate’s identity and award from official institutional records.","Complete every required field, including student number, faculty, department, programme and qualification.","Select the correct award date and check the spelling of every field.","Attach the exact official certificate document (PDF, JPG or PNG) when prompted.","Review the form and select Register institution certificate and generate QR.","Share the generated certificate ID or verification key securely with the graduate."],
    ["Form fields — become part of the credential record and integrity fingerprint.","Official certificate document — attaches the source document to the credential.","Register credential and generate QR — creates the registry record, then generates the QR/link."],
    "The organization must be APPROVED and hold ISSUE_CREDENTIALS. Verifier-only organizations and staff accounts cannot issue credentials.",
    ["Issuance is a consequential action; check all details before submitting.","A failed document upload can leave a registry record without its original file; follow the error message and attach the document before sharing.","The app labels database-ledger mode honestly when blockchain is not configured."],
    ["If issuance is denied, confirm organization approval and that the account is the organization owner.","If the document upload fails after record creation, open Certificates and follow the document upload/recovery workflow; do not issue a duplicate."]),
  g("verify","Verify Issued Credentials",ClipboardCheck,"Check a credential against the records issued by your own organization.","Approved credential-issuer owner. This check is scoped to the organization's own issued records.",
    ["Enter the certificate ID or unique verification key exactly as issued.","Select Check issued record.","Review VERIFIED, REVOKED, NOT FOUND or INTEGRITY MISMATCH and the returned details.","If the result is not as expected, compare it with the organization’s authoritative record and investigate before confirming the award."],
    ["Certificate ID or verification key — accepts either supported reference.","Check issued record — performs an organization-scoped registry and integrity check."],
    "The organization must be APPROVED and hold ISSUE_CREDENTIALS. The check is scoped to credentials issued by this organization.",
    ["Do not describe a NOT FOUND result as proof of fraud without checking for typing errors and issuer records.","A database-ledger check is not an on-chain transaction."],
    ["If not found, remove spaces and recheck the exact reference.","If integrity mismatch appears, stop relying on the record and escalate to the organization’s credential administrator."])
];

const organizationCapabilityGuide = g("identity","Organization Identity & Permissions",Building2,"Maintain official organization identity details and request independently reviewed VERITY service permissions.","Organization owner.",
  ["Open Organization Identity and review the organization name and application status.","Complete the legal identity details and upload the supporting evidence requested by VERITY.","Open Organization service permissions to see Issue credentials and Verify credentials separately.","Request only the capabilities your organization needs. Issuing and external verification are different permissions.","Wait for a VERITY administrator to approve each requested capability. Organization identity approval is required first."],
  ["Organization identity — maintains official registration and supporting evidence.","Issue credentials — requests authority to manage graduate records and issue credentials through the existing VERITY workflows.","Verify credentials — requests authority to verify credentials issued by other organizations and request graduate-consented document access."],
  "The organization must be approved before a requested capability can be approved. Owners can request or resubmit a capability but cannot approve it themselves.",
  ["A capability request is not an approval. Do not use an issuer or verifier workflow until its capability status is APPROVED.","An organization receives only the baseline permission associated with its existing account category; additional permissions require separate administrator review."],
  ["If a request is pending, wait for administrator review and check the decision note.","If a request is rejected, review the administrator's note and resubmit with the required information."]);

const organizationGuides = [
  workspaceOverview,
  organizationCapabilityGuide,
  g("verify","Verify Credentials",Search,"Verify a credential reference or find a graduate record for a legitimate verification purpose.","Organization owner with approved VERIFY_CREDENTIALS permission.",
    ["Confirm that the verification request is within your organization’s lawful and stated purpose.","Enter the certificate ID or verification key and select Verify credential; alternatively use the student lookup form with exact name, student or employee number, institution and department.","Review the returned credential status, issuer and qualification details.","If the graduate is linked to Verity, request permission to view the original document only when it is necessary."],
    ["Verify credential — checks the reference against the Verity registry.","Search Verity records — searches using the exact four student identifiers.","Request graduate consent — sends a private-document access request to the graduate."],
    "The organization must be APPROVED and hold VERIFY_CREDENTIALS. Only its owner or staff with the appropriate permission can use the module.",
    ["A registry match does not independently establish the identity of the person presenting the credential.","Do not attempt broad searches or access documents without a legitimate purpose and graduate consent."],
    ["If no record is found, confirm the exact ID/key with the graduate or issuing institution.","If the organization is pending or suspended, contact the Verity administrator about its status."]),
  g("access","Verification Requests",Share2,"Review graduate consent and access only the private original documents explicitly approved for your organization.","Organization owner with approved VERIFY_CREDENTIALS permission. Verifier-organization staff access is not enabled in this release.",
    ["Open Verification Requests and review the graduate, credential, stated purpose and request status.","Wait until the graduate approves the request; do not attempt to bypass a pending or rejected request.","For an approved request, select Preview original to inspect it inside Verity.","Use Download watermarked copy only when a retained copy is necessary for the stated purpose.","Stop using the document when consent expires or the purpose is complete."],
    ["Preview original — opens a temporary in-app view of the approved original.","Download watermarked copy — downloads the permitted watermarked PDF.","Request status — shows PENDING, APPROVED or REJECTED."],
    "Organization must be APPROVED. Original document access requires graduate approval and expires after 30 days. Verifier-organization staff downloads are not implemented yet.",
    ["Never share, repurpose or retain a certificate beyond the approved purpose and applicable retention rules.","A public verification result does not grant access to the original certificate file."],
    ["If preview/download is denied, check request status, expiry, staff permission and whether the stored document passes its SHA-256 integrity check.","If the graduate is not linked to the certificate, ask them to link their account before sending another request."])
];

const graduateGuides = [
  workspaceOverview,
  g("certificates","My Credentials",FileCheck2,"View credentials linked to your graduate profile and share a verification reference.","Graduate / student account.",
    ["Open My Credentials and review each linked credential.","Check the organization, qualification, award date and current status.","Select QR to display your QR code and verification link.","Use Copy verification link or Copy key to share the reference with a verifier.","Contact the issuing institution if a credential is missing, incorrect or revoked unexpectedly."],
    ["QR — opens the QR and sharing panel.","Copy verification link — copies the public verification URL.","Copy key — copies the unique verification key.","Download — retrieves your linked original document when available and permitted."],
    "Sign in to the graduate account linked to the credential. A certificate must be linked to your account for private document access.",
    ["Share the verification link/key only with people or organizations you intend to verify the credential.","A public QR reveals limited credential information; it does not grant access to the private original document."],
    ["If a credential is missing, ask the organization to issue it with the email linked to your Verity account.","If download is blocked, check whether a document exists and whether its SHA-256 integrity check succeeds."]),
  g("join","Join an Organization",Plus,"Request a secure link between your graduate account and the school or credential-issuing organization that holds your record.","Graduate / student account.",
    ["Obtain the official registration code directly from your organization.","Enter the code exactly; the field converts letters to uppercase.","Enter your student or student or employee number where available.","Select Request institution link and wait for the organization administrator to review it.","Check Your institution links for the current request status."],
    ["Organization registration code — identifies the organization invitation.","Student / student or employee number — helps the organization match your record.","Request institution link — submits a membership request for approval."],
    "Graduate account required. The institution must approve the request before the membership becomes active.",
    ["Only use a code supplied by the organization you actually attended.","Submitting a request does not automatically approve membership or issue a certificate."],
    ["If the code is invalid, request a fresh code from the organization administrator.","If the request remains pending, the organization has not completed its review yet."]),
  g("access","Sharing Requests",Share2,"Control which verification organizations may view your private original certificate documents.","Graduate / student account.",
    ["Open Sharing Requests and inspect each organization name, credential and stated purpose.","Approve only a request from an organization you recognize and expect to verify your qualification.","Select Reject if you do not recognize the organization or do not want to grant access.","Approved access lasts up to 30 days; review requests carefully and contact the organization if the purpose is unclear."],
    ["Approve — grants the requesting organization time-limited access to the selected original document.","Reject — declines the access request.","Request status — shows whether consent is pending, approved or rejected."],
    "Only the graduate account linked to the certificate can approve or reject its access request.",
    ["Approval shares the private original document, not just the public verification result.","Do not approve requests simply because an organization claims urgency. Consent does not change the certificate’s registry status."],
    ["If a request is not listed, ask the organization to confirm it submitted the request for the correct credential.","If access was approved but the organization cannot open the document, ask it to check the 30-day expiry and document integrity status."]),
  g("verify","Verify a Credential",ClipboardCheck,"Check the status of a credential reference using the Verity registry.","Graduate / student account.",
    ["Enter the certificate ID or verification key provided by the issuer.","Select Verify credential and wait for the registry result.","Read the result status and compare the displayed qualification and institution details.","Contact the issuing institution if the result is missing, revoked or inconsistent."],
    ["Certificate ID or verification key — accepts either supported reference.","Verify credential — requests a registry check and displays its result."],
    "Any signed-in graduate can check a public credential reference; the result is limited to the data the registry makes public.",
    ["A successful registry check does not prove the identity of the person presenting the credential.","Do not describe the Supabase database ledger as a public blockchain transaction."],
    ["If not found, re-enter the reference without spaces and confirm it with the issuer.","If details do not match, stop sharing the credential and contact the organization."])
];

const staffGuides = [
  g("overview","Overview",LayoutDashboard,"A quick orientation to your organization staff workspace.","Active staff member at an approved academic institution.",
    ["Open Overview after signing in to confirm your workspace is available.","Use Organization Credentials to review records for the organization that assigned you.","Only certificates:read and documents:download are currently supported staff permissions.","If your assignment or institution is suspended, access is withdrawn."],
    ["Overview — provides a quick workspace orientation.","Organization Credentials — opens records available to your staff assignment."],
    "Staff access is limited to the approved academic institution that created the assignment. Verifier-organization staff workflows are not implemented yet.",
    ["Never share your login or use another staff member’s credentials.","Do not describe the Supabase database ledger as a public blockchain transaction."],
    ["If Organization Credentials is missing, ask the owner to check your ACTIVE assignment and certificates:read permission.","If the organization is suspended, contact the Verity System Administrator."]),
  g("certificates","Organization Credentials",FileCheck2,"Read certificate records and, where assigned, download original files for your organization.","Active staff member with certificates:read at an approved academic institution.",
    ["Open Organization Credentials to view records scoped to the organization that assigned you.","Search by graduate name, certificate ID, institution or programme.","Review the credential status and details needed for your assigned task.","Open document details to check the file name and available integrity information. Download only when documents:download is also assigned and the server confirms SHA-256 integrity."],
    ["Search credentials — filters records visible to your account.","QR — displays a shareable verification reference when available.","Document details — shows the uploaded file metadata and availability.","Download — retrieves the original file only when documents:download is assigned and server-side SHA-256 verification succeeds."],
    "Requires an ACTIVE staff assignment and certificates:read. Document downloads additionally require documents:download. Both permissions are limited to the same approved academic institution.",
    ["Staff cannot issue, edit or revoke certificates, manage students, approve graduate access requests or administer staff.","Missing files or failed SHA-256 integrity verification never permit document download."],
    ["If no records appear, ask the owner to confirm your assignment and institution status.","If download is denied, ask the owner to verify documents:download and confirm that the file passes server-side SHA-256 integrity verification."])
];;

export default function RoleGuidelines({ user, organization, onOpen, data, certificates = [], auditEvents = null, onVerify, canDownload = false }) {
  const [expanded, setExpanded] = useState(0);
  const staffAssignments = (user?.organizationStaff || []).filter(x => x.status === "ACTIVE");
  const isStaff = user?.role === "GRADUATE" && staffAssignments.length > 0;
  const isAdmin = user?.role === "ADMIN";
  const isInstitution = user?.role === "EMPLOYER" && organization?.type === "INSTITUTION";
  const isOrganization = user?.role === "EMPLOYER" && organization?.type === "EMPLOYER";
  const hasIssuerCapability = organization?.capabilities?.some(x => x.capability === "ISSUE_CREDENTIALS" && x.status === "APPROVED");
  const hasVerifierCapability = organization?.capabilities?.some(x => x.capability === "VERIFY_CREDENTIALS" && x.status === "APPROVED");
  const isIssuer = user?.role === "EMPLOYER" && (isInstitution || hasIssuerCapability);
  const canReadAsStaff = staffAssignments.some(x => x.permissions?.includes("certificates:read"));
  const canManageRoster = (user?.institutionICT || []).some(x => x.status === "ACTIVE" && x.permissions?.includes("roster:manage"));
  const canRecoverRoster = (user?.institutionICT || []).some(x => x.status === "ACTIVE" && x.permissions?.includes("registration:recover"));
  const isInstitutionICT = canManageRoster || canRecoverRoster;
  const issuerModules = isIssuer && !isInstitution
    ? institutionGuides.filter(x => !["student-identity","staff"].includes(x.page))
    : institutionGuides;
  const organizationModules = hasVerifierCapability ? organizationGuides : organizationGuides.filter(x => !["verify","access"].includes(x.page));
  const baseModules = isAdmin ? adminGuides : isIssuer ? issuerModules : isOrganization ? organizationModules : isStaff
    ? staffGuides.filter(x => x.page !== "certificates" || canReadAsStaff)
    : graduateGuides;
  const combinedModules = isIssuer && hasVerifierCapability
    ? [...baseModules, ...organizationGuides.filter(x => ["verify","access"].includes(x.page))]
    : baseModules;
  const modules = isInstitutionICT && !isInstitution && !isAdmin
    ? [...combinedModules, ictCentreGuide, ...(canManageRoster ? [bulkStudentGuide] : [])]
    : combinedModules;
  const role = isAdmin ? "SYSTEM ADMINISTRATOR" : isIssuer ? (isInstitution ? "ACADEMIC INSTITUTION" : "CREDENTIAL ISSUER") : isOrganization ? (hasVerifierCapability ? "VERIFICATION ORGANIZATION" : "ORGANIZATION ACCOUNT") : isInstitutionICT ? "INSTITUTION ICT STAFF" : isStaff ? "AUTHORIZED STAFF" : "GRADUATE / STUDENT";
  return <div className="guidelines-page">
    <section className="guidelines-hero">
      <div className="guide-hero-backdrop"><i/><i/><i/><span className="guide-sweep"/></div>
      <div className="guide-hero-mark"><ShieldCheck size={34}/><span>VERITY</span></div>
      <div className="guide-hero-copy"><small>YOUR VERITY WORKSPACE · MODULE-BY-MODULE HELP</small><h1>Every module.<br/><span>One clear way forward.</span></h1><p>Practical instructions for the modules and permissions available to your account.</p><div className="guide-hero-tags"><span><CheckCircle2 size={14}/> Step-by-step guidance</span><span><LockKeyhole size={14}/> Role-based access</span></div></div>
      <div className="guidelines-role">{role}</div><div className="guide-hero-index">VERITY <b>01</b> / MODULE GUIDES</div>
    </section>
    <section className="guide-documentary" aria-label="VERITY product documentary"><div className="guide-documentary-heading"><small>THE VERITY PRODUCT DOCUMENTARY</small><h2>See the platform in action.</h2><p>A guided film showing the real institution, graduate, organization and administrator workflows.</p></div><VerityShowcase data={data} certificates={certificates} auditEvents={auditEvents} organization={organization} onVerify={onVerify} canDownload={canDownload}/></section>
    <div className="guidelines-intro"><div><b>Your module guidebook</b><p>Open a guide for its purpose, intended users, steps, action reference, permissions, warnings and troubleshooting.</p></div><span><BookOpen size={17}/> {modules.length} modules</span></div>
    <div className="guideline-grid">{modules.map((item,i) => { const Icon=item.icon; return <section className={"guideline-card "+(expanded===i?"is-open":"")} key={item.page}>
      <button className="guideline-toggle" onClick={() => setExpanded(expanded===i?-1:i)}><span className="guideline-icon"><Icon size={21}/></span><span className="guideline-heading"><small>MODULE GUIDE {String(i+1).padStart(2,"0")}</small><b>{item.title}</b><em>{item.intro}</em></span><span className="guideline-arrow"><ArrowRight size={17}/></span></button>
      {expanded===i && <div className="guideline-details">
        <div className="guide-detail-block"><b>What this module does</b><p>{item.intro}</p></div>
        <div className="guide-detail-block"><b>Who should use it</b><p>{item.audience}</p></div>
        <div className="guide-detail-block"><b>How to use it</b><ol>{item.steps.map((step,n)=><li key={n}><span>{String(n+1).padStart(2,"0")}</span>{step}</li>)}</ol></div>
        <div className="guide-detail-block"><b>Buttons and actions</b><ul>{item.actions.map((action,n)=><li key={n}>{action}</li>)}</ul></div>
        <div className="guide-detail-block"><b>Permissions and approvals</b><p>{item.permissions}</p></div>
        <div className="guide-detail-block guide-warning"><b><AlertTriangle size={15}/> Warnings and best practices</b><ul>{item.warnings.map((warning,n)=><li key={n}>{warning}</li>)}</ul></div>
        <div className="guide-detail-block"><b>Common mistakes and how to resolve them</b><ul>{item.fixes.map((fix,n)=><li key={n}>{fix}</li>)}</ul></div>
        <button className="guide-open-module" onClick={() => onOpen?.(item.page)}>Open {item.title} <ArrowRight size={14}/></button>
      </div>}
    </section>;})}</div>
    <section className="guidelines-foot"><ShieldCheck size={22}/><div><b>Built around trust, consent and accurate records.</b><p>Verity reports blockchain confirmation only when a network and contract are connected. Database-ledger checks are clearly distinguished from on-chain transactions.</p></div></section>
  </div>;
}
