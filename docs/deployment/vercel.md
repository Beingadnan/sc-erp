# Deploying to Vercel

The app runs as two Vercel projects from the same GitHub repository, both in Mumbai (`bom1`).

| Project      | Root directory | What it serves                                        |
| ------------ | -------------- | ----------------------------------------------------- |
| `sc-erp-api` | `apps/api`     | The Nest API as one Vercel Function (`api/index.mjs`) |
| `sc-erp`     | `apps/web`     | The Next.js app; forwards `/api/*` to the API         |

Build settings come from each folder's `vercel.json`; leave the dashboard defaults alone.

## 1. Database

Run the migrations against Neon once from your computer (with `.env` pointing at Neon):

```sh
pnpm db:setup
```

## 2. API project (`apps/api`)

Environment variables:

| Name                  | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| `NODE_ENV`            | `production`                                             |
| `DATABASE_URL_APP`    | Neon **pooled** URL for the `erp_app` role               |
| `DATABASE_URL_OWNER`  | Neon URL for the owner role                              |
| `MFA_ENCRYPTION_KEY`  | `openssl rand -base64 32` (keep the same value forever)  |
| `APP_URL`             | The web project's URL, e.g. `https://sc-erp.vercel.app`  |
| `API_CORS_ORIGINS`    | Same as `APP_URL`                                        |
| `TRUST_PROXY_HOPS`    | `1`                                                      |
| `PROXY_SHARED_SECRET` | `openssl rand -hex 32` — the same value in both projects |

Then Storage → create a **private** Blob store in Mumbai and connect it to this project; that
adds `BLOB_READ_WRITE_TOKEN` (documents need it in production).

## 3. Web project (`apps/web`)

| Name                  | Value                                                       |
| --------------------- | ----------------------------------------------------------- |
| `API_URL`             | The API project's URL, e.g. `https://sc-erp-api.vercel.app` |
| `PROXY_SHARED_SECRET` | Same value as in the API project                            |

`src/proxy.ts` forwards `/api/*` to `API_URL` with the visitor's IP and the shared secret, so
cookies stay first-party and rate limits see real visitors.

## Before going live

- Never seed demo data into the production database: the demo passwords are public.
- The background worker (`apps/worker`, outbox events) is not deployed yet.
