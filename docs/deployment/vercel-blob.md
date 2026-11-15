# Setting up document storage (Vercel Blob)

Without this, documents are saved on your computer in `.storage/` — fine for trying the
app, not for real schools.

1. Sign in at vercel.com → **Storage** → **Create** → **Blob**.
2. Name it e.g. `school-erp-documents`, set **Access: Private**, **Region: Mumbai (bom1)**.
   The access mode cannot be changed later, so double-check *Private*.
3. Open the store → **.env.local** tab (or *Settings → Tokens*) and copy
   `BLOB_READ_WRITE_TOKEN`.
4. Add it to the project's `.env` (never commit it, never paste it in chat):
   ```
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
   ```
5. Restart `pnpm dev`. The API log shows the storage in use; new uploads go to Vercel Blob.

Existing files uploaded to `.storage/` while testing are not moved; re-upload them if needed.

To rotate the token: create a new one in the store settings, update `.env`, restart, then
revoke the old one.
