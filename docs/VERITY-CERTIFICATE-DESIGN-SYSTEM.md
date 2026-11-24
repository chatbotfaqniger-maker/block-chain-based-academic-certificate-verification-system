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

The institution workspace now provides the design-studio interface and authenticated endpoints to save VERITY template drafts, upload original artwork privately, submit historical certificate scans, and approve/reject pending digitisation cases. The PostgreSQL migration and access-boundary assertions pass CI. The PDF field-position editor, final PDF renderer, template activation, normal issuance integration, and conversion of an approved digitisation case into a VERITY credential are still pending. Saved designs remain drafts and cannot yet be used to render or issue certificates. Do not apply this migration directly to production ahead of the reviewed application release.
