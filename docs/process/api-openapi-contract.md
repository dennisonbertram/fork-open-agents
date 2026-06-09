# OpenAPI Contract & Typed Client

A machine-readable OpenAPI document and a generated, typed HTTP client for a
vetted subset of the Open Agents API. The point: the frontend consumes a typed
contract that is derived from the SAME Zod schemas the routes validate against,
so request/response types can't silently drift from the backend.

This pairs with the runtime [API Contract Tests](api-contract-tests.md): the
spec describes the contract, the contract suite proves a running server honors
it.

## Pipeline

```
route Zod schemas ─► lib/api/openapi-spec.ts ─► openapi.json ─► openapi-types.ts ─► lib/api/client.ts
   (source of truth)     (assembles the doc)    (artifact)      (generated types)    (typed client)
```

- **`apps/web/lib/api/openapi-spec.ts`** — the source of truth. Imports the
  route request schemas (`lib/skills/skill-types`, `lib/git/http-schemas`) and
  builds an OpenAPI 3.0 document with `z.toJSONSchema` (zod 4, no extra deps).
  Request bodies use the `input` shape, responses the `output` shape.
- **`apps/web/openapi.json`** — the generated, committed artifact.
- **`apps/web/lib/api/openapi-types.ts`** — TypeScript types generated from the
  artifact by `openapi-typescript`. Generated; ignored by lint/format.
- **`apps/web/lib/api/client.ts`** — a thin typed client over `openapi-fetch`.

## Consuming the contract (frontend)

```ts
import { createOpenAgentsApiClient } from "@/lib/api/client";

const api = createOpenAgentsApiClient(); // same-origin in the browser

const { data, error } = await api.GET("/api/settings/skills");
//      ^? { skills: UserSkill[] } | undefined

await api.POST("/api/settings/skills", {
  body: { name: "my-skill", description: "…", body: "…" },
  //     ^ checked against the createSkill request schema
});
```

Paths, methods, params, request bodies, and response shapes are all checked at
compile time against the spec.

## Regenerating after a route change

When you add or change a covered route's schema, update `openapi-spec.ts`, then:

```bash
bun run --cwd apps/web openapi:generate   # rewrite openapi.json
bun run --cwd apps/web openapi:types      # regenerate openapi-types.ts
```

Commit both generated files alongside the spec change.

## Drift guard

`bun run --cwd apps/web openapi:check` fails if `openapi.json` is stale relative
to `openapi-spec.ts`. The same check runs as a unit test
(`lib/api/openapi-spec.test.ts`), so `bun run ci` catches a forgotten
regeneration. That test also asserts every operation has a unique `operationId`
and documents a `401` (all endpoints require auth).

## Scope

Seeded with the strongly-typed resources — skills CRUD and the git/GitHub
session routes. Extend `openapi-spec.ts` as more routes adopt explicit Zod
schemas; prefer growing this typed surface over hand-written `fetch` calls.
