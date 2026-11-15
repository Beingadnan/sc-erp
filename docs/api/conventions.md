# API Conventions

- Base path `/api/v1`; URI versioning; JSON only; OpenAPI at `/api/docs` (non-production).
- Resources are plural nouns: `/api/v1/students/{id}`. Actions that are not CRUD use
  sub-resources: `POST /api/v1/fee-invoices/{id}/payments`.
- Tenant is **never** in the URL or body; it comes from the session + subdomain.
- IDs are UUIDs. Unknown or other-tenant IDs return **404**, never 403.
- Lists: `?limit=25&cursor=…` (max 100), response `{ data: [...], nextCursor: string | null }`.
  Filters are explicit query params validated by Zod.
- Dates `YYYY-MM-DD`; timestamps ISO-8601 UTC; money as decimal **strings** `"1250.50"` with a
  `currency` field.
- Non-idempotent POSTs that create money movements, imports or messages require an
  `Idempotency-Key` header (16–128 chars); repeated keys return the first result.
- Every response carries `X-Request-Id`.

## Errors

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "requestId": "…", "details": {} } }
```

| HTTP | code                                                          |
| ---- | ------------------------------------------------------------- |
| 401  | UNAUTHENTICATED, TENANT_CONTEXT_MISSING                       |
| 403  | FORBIDDEN (has access to the tenant but lacks the permission) |
| 404  | NOT_FOUND                                                     |
| 409  | CONFLICT (state/version conflicts, duplicate keys)            |
| 422  | VALIDATION_FAILED (`details.fields`)                          |
| 429  | RATE_LIMITED                                                  |
| 500  | INTERNAL (no internals exposed)                               |

## Webhooks

`POST /api/v1/webhooks/{provider}` — raw body kept for signature verification, event id stored
uniquely before processing, 2xx returned only after the event is durably recorded.
