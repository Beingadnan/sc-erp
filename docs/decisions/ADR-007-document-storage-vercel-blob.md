# ADR-007: Document storage on Vercel Blob (private, Mumbai)

Date: 2026-11-11 · Status: accepted (owner decision)

## Context

Students and applications need documents (birth certificates, transfer certificates, report
cards, Aadhaar copies). These are children's personal data: they must never be publicly
reachable, links must expire, every opening must be logged, and data should stay in India.

## Decision

Use **Vercel Blob with a private store in the Mumbai region (bom1)**.

- Files are uploaded by the API (not directly by browsers), after the API checks permission,
  file size (≤ 5 MB) and the real file type from its first bytes (PDF, JPG, PNG, WebP only).
- Object keys are `t/<school>/d/<document>/<safe-name>`; only keys recorded in our database
  are ever signed.
- Opening a document = the API checks permission, logs `document.downloaded`, and returns a
  **5-minute, GET-only signed URL** for that one object (`issueSignedToken` + `presignUrl`).
- Removing a document deletes the file; the database record stays (who, when) for the audit
  trail.
- Development uses a local-disk driver with the same behaviour (HMAC-signed expiring links).
  The API refuses to start in production without a Blob token.

## Alternatives considered

- Cloudflare R2 / AWS S3 (Mumbai): equally suitable; S3-compatible. Not chosen — the owner
  prefers Vercel. The storage interface (`FileStorage`) keeps a later switch to a small change.
- Database storage (bytea): simple but bloats Neon storage and backups.

## Consequences

- Needs `BLOB_READ_WRITE_TOKEN` (a long-lived secret) while the API runs outside Vercel. When
  the API is deployed on Vercel, switch to OIDC authentication (no stored token).
- Costs (bom1): storage about $0.025/GB-month plus operations and transfer — small for
  school documents.
- Files are encrypted at rest by the provider; we do not add our own file encryption in this
  phase (Aadhaar _numbers_ are encrypted by us separately).
