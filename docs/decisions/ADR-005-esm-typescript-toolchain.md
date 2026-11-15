# ADR-005: Native ESM, TypeScript 6, pinned dependency versions

- Status: Accepted (2026-11-11)

## Context

NestJS 12 ships as ECMAScript modules only. TypeScript 7 exists but typescript-eslint
supports TypeScript < 6.1.

## Decision

All packages are `"type": "module"` with `module: nodenext` and explicit `.js` import
suffixes. TypeScript 6.0 until the lint tooling supports 7. Exact versions are pinned in
package.json; upgrades come through dependency PRs with CI.

## Consequences

- One module system everywhere; no CJS/ESM interop surprises.
  − Relative imports need `.js` suffixes.
