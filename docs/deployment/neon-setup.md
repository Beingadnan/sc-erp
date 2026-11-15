# Neon Setup (one time, ~10 minutes)

Never paste connection strings or passwords into chat, tickets or commits. They go only in
`.env` (git-ignored) and in your hosting/CI secret store.

## 1. Project and branches

1. In the Neon console create project **school-erp**, region **AWS Asia Pacific (Singapore)**,
   latest Postgres version.
2. Under **Branches** create `staging` and `dev` from `main`.
3. Use the `dev` branch for local development.

## 2. Connection strings for the `dev` branch

Open **Connect** on the `dev` branch, role `neondb_owner`, database `neondb`:

- With **Connection pooling OFF** → copy the string → this is `DATABASE_URL_OWNER`.
- Note the host. The pooled host is the same with `-pooler` after the endpoint id, e.g.
  `ep-cool-sun-123456-pooler.ap-southeast-1.aws.neon.tech`.

## 3. Local `.env`

```bash
cp .env.example .env
```

Fill in:

- `DATABASE_URL_OWNER` — the direct owner string from step 2.
- `ERP_APP_PASSWORD` — generate one: `openssl rand -base64 24 | tr -d '/+=' | head -c 24`
  (must contain letters and digits).
- `MFA_ENCRYPTION_KEY` — generate one: `openssl rand -base64 32`. Keep it safe: if it is lost,
  everyone has to set up two-step verification again.
- `DATABASE_URL_APP` —
  `postgresql://erp_app:<ERP_APP_PASSWORD>@<pooled host>/neondb?sslmode=require`

## 4. Initialise the database

```bash
pnpm install
pnpm db:setup   # = build packages, db:migrate, db:setup-app-role, db:check-rls
```

`pnpm db:setup` should end with **RLS check passed**.

Do **not** create `erp_app` in the Neon console — console roles can bypass RLS.

## 5. Run

```bash
docker compose up -d redis   # or use Upstash and set REDIS_URL
pnpm dev                     # api :4000, web :3000, worker
curl localhost:4000/api/v1/health/ready
```

## 6. Make yourself a platform administrator (optional)

Register your own school in the web app first, then:

```bash
pnpm --filter @school-erp/db grant-platform-admin you@example.com super_admin
```

Platform staff can list all schools and suspend or restore them (Phase 2). Nobody can gain
this role through the app itself.

## 7. Other branches

Repeat steps 2–4 for `staging` (and `main` before the pilot) with a **different**
`ERP_APP_PASSWORD` per branch. Branches created from `dev` inherit its roles.

## 8. CI (optional now, recommended before Phase 2 merges)

In GitHub → Settings → Secrets and variables → Actions:

- Variable `NEON_PROJECT_ID`
- Secret `NEON_API_KEY` (Neon → Account → API keys)
- Secret `NEON_CI_APP_PASSWORD` (any strong password; CI sets it on each PR branch)

The `neon-branch` job then runs the isolation suite on a throwaway Neon branch through the real
pooler for every pull request.
