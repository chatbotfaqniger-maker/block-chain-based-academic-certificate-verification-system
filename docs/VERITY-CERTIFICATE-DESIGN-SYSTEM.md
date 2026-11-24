# VERITY Certificate Design System — Product and Data Contract

## Decision

VERITY supports three institution-controlled document paths without changing its certificate registry, cryptographic digest, append-only ledger, verification-key, or Supabase-first architecture.

1. **Institution original design** — an approved institution uploads its authorized certificate artwork once. VERITY stores the artwork privately and maps approved dynamic fields onto it.
2. **VERITY professional templates** — the institution chooses a built-in VERITY template and configures its institution identity, approved logo/seal assets, signatory labels and field layout.
3. **Existing certificate digitisation** — the institution submits an already-issued PDF/image and the claimed academic record for review. The uploaded scan remains a private evidence item and is not a VERITY credential until an authorized institution reviewer validates the source record and explicitly issues a matching credential through the normal issuance workflow.

## Non-negotiable invariants

- A QR code, image, PDF, filename, or upload alone never proves authenticity.
- The canonical credential record and its SHA-256 digest remain the verification source; the rendered document is a presentation artefact.
- Every issued credential receives its own certificate ID, verification key, digest and ledger event.
- Artwork and source scans stay in private Supabase Storage. No public buckets or public storage URLs.
- Institution data and templates are tenant-scoped. Only the owning institution and authorized VERITY administrators may inspect template/review metadata.
- A template change affects future rendering only. It must never silently replace or rewrite already-issued documents.
- Original uploaded certificate files are retained as evidence with their SHA-256 fingerprint; a regenerated PDF must not be represented as the historical original.
- Digitisation cases require human institutional review. Rejected or pending scans cannot produce a successful verification result.
- The existing 500-record durable batch limit and worker activation policy remain unchanged; this feature does not turn on disabled background workers.

## Data model

InstitutionCertificateTemplate stores template identity, source type, private asset path and fingerprint, page size, field layout, version, active/default status and ownership. A partial unique index permits only one active default template per institution.

CertificateDigitizationCase stores the institution-scoped review case, claimed student/award details, private source file path, file type/size/hash, review decision and the resulting certificate reference. The table does not expose write access to browser roles; server-side operations use the service-role client after institution ownership and approval checks.

## Storage

Reuse the existing private verity-certificates bucket. Use organization-scoped prefixes:
- templates/<organization-id>/<template-id>/...
- digitization/<organization-id>/<case-id>/...

Validate actual PDF/JPEG/PNG signatures, cap each file at 10 MB, calculate SHA-256 server-side and remove the uploaded object if its metadata insert fails. VERITY does not claim antivirus scanning.

## Current implementation boundary

The institution workspace provides authenticated draft-template and digitisation workflows. A server-side PDF preview renderer supports the three built-in VERITY layouts and institution artwork (PDF/JPEG/PNG), verifies stored artwork fingerprints, validates normalized field coordinates, embeds a clearly non-verifying preview QR, and streams a private no-store PDF preview. The workspace includes drag-and-drop field positioning, authenticated layout persistence, and explicit institution-owner approval/activation. Activation verifies artwork integrity and renders an approval PDF before setting the institution default. Active designs are locked against in-place editing; future changes require a new draft/version.

Single issuance renders the approved active default design into a private PDF and records its SHA-256 fingerprint in CertificateDocument. Durable bulk issuance supports both the existing staged-PDF methods and CSV_GENERATED, where each item renders its own official PDF from the active design while preserving queue idempotency, retry/reconciliation and document-integrity handling. The institution client accepts CSV and standard unencrypted XLSX workbooks, parses the first worksheet, permits direct editing of imported student fields, revalidates required fields, email and award dates, detects duplicate matriculation numbers, and blocks invalid rows from submission. The existing CSV + ZIP-of-PDFs and CSV + multiple-PDF methods remain available. Legacy .xls files and encrypted workbooks are not supported.

Approved historical digitisation cases can be converted into canonical VERITY credentials through a restricted service-role-only atomic database RPC. The endpoint rechecks the original scan's MIME signature, size and SHA-256 fingerprint; the RPC verifies the institution and approved case identity, inserts the canonical certificate (triggering the existing append-only ledger), and marks the case ISSUED in the same transaction. The original scan remains unchanged in private storage and is attached as private evidence. Repeated conversion returns the existing credential without creating another certificate or ledger event. PostgreSQL CI assertions cover approved-only conversion, ledger creation, idempotency and RPC privileges. Full API/worker end-to-end acceptance testing and review of the stacked pull requests remain release gates. Do not treat this branch as production-ready or apply its migrations directly to production before the reviewed release.
