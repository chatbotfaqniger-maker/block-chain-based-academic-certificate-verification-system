import React, { useState } from "react";
import VerityShowcase from "./Showcase.jsx";
import {
  BookOpen, ShieldCheck, ArrowRight, AlertTriangle, LockKeyhole,
  CheckCircle2, LayoutDashboard, Building2, FileCheck2, Activity,
  Settings, GraduationCap, Users, Plus, Search, Share2, ClipboardCheck, FileSpreadsheet
} from "lucide-react";

const g = (page, title, icon, intro, audience, steps, actions, permissions, warnings, fixes) => ({
  page, title, icon, intro, audience, steps, actions, permissions, warnings, fixes
});

const workspaceOverview = g("overview","Overview",LayoutDashboard,"Your workspace home summarizes the services available to your signed-in role.","Graduate, institution owner or verification organization owner.",
  ["Open Overview after signing in to see the services available to your account.","Review the cards and recent activity shown for your role; these differ between graduates, institutions and verifier organizations.","Use the navigation to open a module, then return to Overview for a workspace summary.","Refresh the page after important actions when you need the latest status."],
  ["Overview cards — summarize the activity available to your role.","Navigation — opens the modules enabled for your account."],
  "Only modules allowed by your account role and organization approval are available. Institution staff permissions are limited to certificates:read and documents:download.",
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

const institutionGuides = [
  workspaceOverview,
  g("bulk-students","Bulk Student Import",FileSpreadsheet,"Import and manage large student cohorts without creating login accounts for every student.","Approved academic institution owner.",
    ["Download the official VERITY student CSV template.","Export the student roster from your student information system and map the required fields: student number, full name, faculty, department, programme and qualification.","Add optional email, classification and award date values only when accurate.","Upload the CSV and review validation errors and duplicate matriculation numbers before starting the import.","Monitor the progress indicator and review the batch history for inserted, duplicate and rejected rows.","If an import is interrupted, re-upload the same file; existing institution/student-number pairs are skipped instead of duplicated."],
    ["Download template — provides the supported CSV headers and an example row.","Choose student CSV file — reads a CSV locally and displays a preview before submission.","Import — submits valid records in sequential batches of up to 100 rows.","Import history — shows recent batch outcomes.","Student directory — searches the latest 100 roster records."],
    "Only the approved institution owner can import student rosters. Student roster records are separate from Supabase Auth accounts and do not automatically issue certificates or grant access to private documents.",
    ["Verify the source spreadsheet before upload and share student data only with authorized institutional staff.","Student numbers are unique within an institution. Existing numbers are skipped rather than overwritten.","Do not upload passwords, national identity numbers or unrelated sensitive data."],
    ["If required columns are missing, download the template and correct the header names.","If a row is rejected, correct its missing or invalid values and re-upload the CSV.","If a batch is interrupted, check its status and re-upload the same file; duplicate student numbers will be skipped."]),

  g("identity","Identity",Building2,"Submit official institutional identity details and supporting evidence for review.","Institution administrator / organization owner for an academic institution.",
    ["Open Institution Identity and confirm the institution name and current application status.","Enter the official registration number, website, email domain and accreditation or supervising body where requested.","Upload the official registration or accreditation evidence using the evidence form.","Submit the evidence and wait for a Verity System Administrator to review it. Respond to any clarification request."],
    ["Evidence type — labels the kind of official document being submitted.","Choose file — selects the supporting evidence file.","Submit evidence — uploads the file to the private evidence area for manual review."],
    "Institution owner account. The institution must be approved before issuing certificates or activating other approval-gated services.",
    ["Use official, current evidence and ensure the document belongs to the institution.","Do not upload unrelated student records as institution identity evidence."],
    ["If upload is rejected, check the file type/size and retry with a clear PDF or image.","If status remains Pending, the application is awaiting human review; contact Verity support rather than repeatedly submitting duplicates."]),
  g("students","Students / Employees",GraduationCap,"Review and manage membership requests from graduates who want to link their account to your institution.","Approved institution administrator and authorized institution staff where access is provided.",
    ["Share the institution registration code with the intended student or employee through a trusted channel.","Open Students / Employees and review pending membership requests.","Check the person’s name and student/matriculation number against official institutional records.","Approve a matching request or reject an incorrect or unauthorized request.","Contact the graduate if the submitted details need correction before approval."],
    ["Copy code — copies the institution registration code for secure sharing.","Approve — activates the membership link after the institution’s review.","Reject — declines the selected membership request."],
    "Organization owner must be approved to approve membership requests. Graduates create their own Verity accounts and request the link.",
    ["Verify identity and student number before approving.","Treat registration codes as controlled invitations; do not publish them publicly."],
    ["If a student is missing, ask them to register and submit the correct code.","If approval is disabled, confirm the institution is APPROVED and you are signed in as its owner."]),
  g("staff","Staff",Users,"Assign limited, auditable access to existing Verity graduate accounts.","Approved academic institution owner.",
    ["Ask the staff member to create their own Verity graduate account first.","Open Staff and enter the exact email address used by that account.","Assign certificates:read for read-only access to this institution’s credential records.","Add documents:download only when the staff member needs to retrieve original certificate files; this permission requires certificates:read as well.","Select Add staff member and confirm the assignment appears as ACTIVE. Suspend access promptly when duties change or the staff member leaves."],
    ["Staff email — identifies an existing Verity account.","certificates:read — grants read-only access to this institution’s certificate records.","documents:download — allows downloads for this institution when the document passes file-signature and SHA-256 integrity checks.","Add staff member — creates or updates the assignment; Suspend / Reactivate changes active access."],
    "Only an approved academic institution owner can assign staff. The only implemented staff permissions are certificates:read and documents:download. Verifier-organization staff and verification permissions are not available yet. Staff cannot issue or revoke certificates or administer other staff.",
    ["Never share an owner account or grant permissions for convenience.","Only enable document download when required for the staff member’s work."],
    ["If an email is not found, ask the person to register using that exact email.","If a staff member cannot see a module, check their ACTIVE status and assigned permission set."]),
  g("certificates","Certificates",FileCheck2,"Review credentials issued by your institution and manage available certificate records.","Approved institution owner; staff access is read-only and limited to assigned permissions.",
    ["Search for the graduate or certificate before creating another record.","Check the graduate name, student number, programme, qualification and award date against the institution’s authoritative record.","Open the record and inspect its status and available document/QR controls.","Use the record’s QR or verification link to share a credential reference with the graduate."],
    ["Search credentials — filters the visible list.","QR — opens the QR and verification-link panel.","Download — available to the graduate for their own linked document; staff downloads require the assigned permission and valid access.","Revoke — available only to an authorized issuer/owner and requires a reason."],
    "Approved institution owner can issue/revoke its own records. Staff with certificates:read can inspect assigned organization records; they do not inherit owner privileges.",
    ["Do not create duplicate certificates to correct a record without following the institution’s correction/revocation process.","A document preview or download is blocked when the file is missing or its stored SHA-256 fingerprint is missing or does not match."],
    ["If a certificate is absent, verify that it was issued by this institution and that the student link is correct.","If a file is blocked, check the upload details and SHA-256 integrity status; contact the issuer if the original needs to be uploaded again."]),
  g("issue","Issue Certificate",Plus,"Register an academic award and generate its Verity certificate reference and QR.","Approved academic institution owner only.",
    ["Confirm the graduate’s identity and award from official institutional records.","Complete every required field, including student number, faculty, department, programme and qualification.","Select the correct award date and check the spelling of every field.","Attach the exact official certificate document (PDF, JPG or PNG) when prompted.","Review the form and select Register institution certificate and generate QR.","Share the generated certificate ID or verification key securely with the graduate."],
    ["Form fields — become part of the credential record and integrity fingerprint.","Official certificate document — attaches the source document to the credential.","Register institution certificate and generate QR — creates the registry record, then generates the QR/link."],
    "The organization must be an APPROVED INSTITUTION. Employer/verifier organizations and staff accounts cannot issue academic credentials.",
    ["Issuance is a consequential action; check all details before submitting.","A failed document upload can leave a registry record without its original file; follow the error message and attach the document before sharing.","The app labels database-ledger mode honestly when blockchain is not configured."],
    ["If issuance is denied, confirm organization approval and that the account is the institution owner.","If the document upload fails after record creation, open Certificates and follow the document upload/recovery workflow; do not issue a duplicate."]),
  g("verify","Verify Student Certificates",ClipboardCheck,"Check a credential against the records issued by your own institution.","Approved academic institution owner and institution-authorized staff where verification permission is assigned.",
    ["Enter the certificate ID or unique verification key exactly as issued.","Select Check institutional record.","Review VERIFIED, REVOKED, NOT FOUND or INTEGRITY MISMATCH and the returned details.","If the result is not as expected, compare it with the institution’s authoritative record and investigate before confirming the award."],
    ["Certificate ID or verification key — accepts either supported reference.","Check institutional record — performs an institution-scoped registry and integrity check."],
    "Institution must be APPROVED. The check is scoped to credentials issued by this institution.",
    ["Do not describe a NOT FOUND result as proof of fraud without checking for typing errors and issuer records.","A database-ledger check is not an on-chain transaction."],
    ["If not found, remove spaces and recheck the exact reference.","If integrity mismatch appears, stop relying on the record and escalate to the institution’s credential administrator."])
];

const organizationGuides = [
  workspaceOverview,
  g("verify","Verify Credentials",Search,"Verify a credential reference or find a graduate record for a legitimate verification purpose.","Approved employer, recruiter, admissions or other verification organization.",
    ["Confirm that the verification request is within your organization’s lawful and stated purpose.","Enter the certificate ID or verification key and select Verify credential; alternatively use the student lookup form with exact name, matriculation number, institution and department.","Review the returned credential status, issuer and qualification details.","If the graduate is linked to Verity, request permission to view the original document only when it is necessary."],
    ["Verify credential — checks the reference against the Verity registry.","Search Verity records — searches using the exact four student identifiers.","Request graduate consent — sends a private-document access request to the graduate."],
    "Organization must be APPROVED and registered as an EMPLOYER/verifier organization. Only its owner or staff with the appropriate permission can use the module.",
    ["A registry match does not independently establish the identity of the person presenting the credential.","Do not attempt broad searches or access documents without a legitimate purpose and graduate consent."],
    ["If no record is found, confirm the exact ID/key with the graduate or issuing institution.","If the organization is pending or suspended, contact the Verity administrator about its status."]),
  g("access","Verification Requests",Share2,"Review graduate consent and access only the private original documents explicitly approved for your organization.","Approved verification organization owner. Staff access for verifier organizations is not implemented yet.",
    ["Open Verification Requests and review the graduate, credential, stated purpose and request status.","Wait until the graduate approves the request; do not attempt to bypass a pending or rejected request.","For an approved request, select Preview original to inspect it inside Verity.","Use Download watermarked copy only when a retained copy is necessary for the stated purpose.","Stop using the document when consent expires or the purpose is complete."],
    ["Preview original — opens a temporary in-app view of the approved original.","Download watermarked copy — downloads the permitted watermarked PDF.","Request status — shows PENDING, APPROVED or REJECTED."],
    "Organization must be APPROVED. Original document access requires graduate approval and expires after 30 days. Verifier-organization staff downloads are not implemented yet.",
    ["Never share, repurpose or retain a certificate beyond the approved purpose and applicable retention rules.","A public verification result does not grant access to the original certificate file."],
    ["If preview/download is denied, check request status, expiry, staff permission and whether the stored document passes its SHA-256 integrity check.","If the graduate is not linked to the certificate, ask them to link their account before sending another request."])
];

const graduateGuides = [
  workspaceOverview,
  g("certificates","My Credentials",FileCheck2,"View credentials linked to your graduate profile and share a verification reference.","Graduate / student account.",
    ["Open My Credentials and review each linked credential.","Check the institution, qualification, award date and current status.","Select QR to display your QR code and verification link.","Use Copy verification link or Copy key to share the reference with a verifier.","Contact the issuing institution if a credential is missing, incorrect or revoked unexpectedly."],
    ["QR — opens the QR and sharing panel.","Copy verification link — copies the public verification URL.","Copy key — copies the unique verification key.","Download — retrieves your linked original document when available and permitted."],
    "Sign in to the graduate account linked to the credential. A certificate must be linked to your account for private document access.",
    ["Share the verification link/key only with people or organizations you intend to verify the credential.","A public QR reveals limited credential information; it does not grant access to the private original document."],
    ["If a credential is missing, ask the institution to issue it with the email linked to your Verity account.","If download is blocked, check whether a document exists and whether its SHA-256 integrity check succeeds."]),
  g("join","Join an Institution",Plus,"Request a secure link between your graduate account and your school or employer institution.","Graduate / student account.",
    ["Obtain the official registration code directly from your institution.","Enter the code exactly; the field converts letters to uppercase.","Enter your student or matriculation number where available.","Select Request institution link and wait for the institution administrator to review it.","Check Your institution links for the current request status."],
    ["Institution registration code — identifies the organization invitation.","Student / matriculation number — helps the institution match your record.","Request institution link — submits a membership request for approval."],
    "Graduate account required. The institution must approve the request before the membership becomes active.",
    ["Only use a code supplied by the institution you actually attended.","Submitting a request does not automatically approve membership or issue a certificate."],
    ["If the code is invalid, request a fresh code from the institution administrator.","If the request remains pending, the institution has not completed its review yet."]),
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
    ["If not found, re-enter the reference without spaces and confirm it with the issuer.","If details do not match, stop sharing the credential and contact the institution."])
];

const staffGuides = [
  g("overview","Overview",LayoutDashboard,"A quick orientation to your institution staff workspace.","Active staff member at an approved academic institution.",
    ["Open Overview after signing in to confirm your workspace is available.","Use Organization Credentials to review records for the institution that assigned you.","Only certificates:read and documents:download are currently supported staff permissions.","If your assignment or institution is suspended, access is withdrawn."],
    ["Overview — provides a quick workspace orientation.","Organization Credentials — opens records available to your staff assignment."],
    "Staff access is limited to the approved academic institution that created the assignment. Verifier-organization staff workflows are not implemented yet.",
    ["Never share your login or use another staff member’s credentials.","Do not describe the Supabase database ledger as a public blockchain transaction."],
    ["If Organization Credentials is missing, ask the owner to check your ACTIVE assignment and certificates:read permission.","If the institution is suspended, contact the Verity System Administrator."]),
  g("certificates","Organization Credentials",FileCheck2,"Read certificate records and, where assigned, download original files for your institution.","Active staff member with certificates:read at an approved academic institution.",
    ["Open Organization Credentials to view records scoped to the institution that assigned you.","Search by graduate name, certificate ID, institution or programme.","Review the credential status and details needed for your assigned task.","Open document details to check the file name and available integrity information. Download only when documents:download is also assigned and the server confirms SHA-256 integrity."],
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
  const canReadAsStaff = staffAssignments.some(x => x.permissions?.includes("certificates:read"));
  const modules = isAdmin ? adminGuides : isInstitution ? institutionGuides : isOrganization ? organizationGuides : isStaff
    ? staffGuides.filter(x => x.page !== "certificates" || canReadAsStaff)
    : graduateGuides;
  const role = isAdmin ? "SYSTEM ADMINISTRATOR" : isInstitution ? "ACADEMIC INSTITUTION" : isOrganization ? "VERIFICATION ORGANIZATION" : isStaff ? "AUTHORIZED STAFF" : "GRADUATE / STUDENT";
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
