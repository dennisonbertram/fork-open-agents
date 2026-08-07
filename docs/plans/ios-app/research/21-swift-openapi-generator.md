# Research Brief 21: apple/swift-openapi-generator as the typed API client for the open-agents iOS app

Date: 2026-06-09. Researcher: subagent (external research + repo grounding).
Repo grounding: `/Users/dennison/develop/open-agents/apps/web/openapi.json` and its generation scripts.

---

## 1. Executive recommendation

Use **swift-openapi-generator (1.12.x) + swift-openapi-runtime (1.12.x) + swift-openapi-urlsession (1.3.x)**, with **CLI/command-plugin pre-generation** (generated Swift checked into git, drift-checked in CI) rather than the SPM build plugin. Inject auth with a `ClientMiddleware`. SSE chat streaming **can** go through the generated client (declare `text/event-stream: {}` in the spec; decode with the runtime's `asDecodedServerSentEventsWithJSONData`), but the repo's current `openapi.json` does not contain any chat/streaming endpoints yet, and it has one **blocking spec hazard** (`additionalProperties: false` everywhere) that must be fixed before generating a resilient client (Section 8.1).

---

## 2. Current versions (verified June 2026)

| Package | Latest | Date | Notes |
|---|---|---|---|
| `apple/swift-openapi-generator` | **1.12.2** | 2026-05-21 | Build-time tool; CLI + SPM plugins ([releases](https://github.com/apple/swift-openapi-generator/releases)) |
| `apple/swift-openapi-runtime` | **1.12.0** | 2026-05-21 | Library the generated code links against ([releases](https://github.com/apple/swift-openapi-runtime/releases)) |
| `apple/swift-openapi-urlsession` | **1.3.0** | 2026-04-16 | `URLSessionTransport` client transport ([releases](https://github.com/apple/swift-openapi-urlsession/releases)) |

Toolchain/platform requirements (verified from each repo's `Package.swift` on `main`):

- All three packages are `swift-tools-version: 6.1` → **building requires Swift 6.1+** (Xcode 16.3+; any 2026 Xcode qualifies). Generator 1.12.0 explicitly dropped Swift 6.0; 1.11.1 dropped 5.10.
- Runtime + URLSession transport **deployment targets: iOS 13+, macOS 10.15+, visionOS 1+** — far below any plausible app target.
- **URLSession transport streaming requires iOS 15+ / macOS 12+** (README: "Streaming support only available on macOS 12+, iOS 15+, tvOS 15+, watchOS 8+, and visionOS 1+") — relevant for SSE. https://github.com/apple/swift-openapi-urlsession
- Apple semver discipline is good: 1.x has been API-stable since Jan 2024 ([1.0 announcement](https://swift.org/blog/swift-openapi-generator-1.0/)); generated-code API stability is a documented guarantee ("API stability of generated code" DocC article).

## 3. OpenAPI version support

- Supports **OpenAPI 3.0.x and 3.1.x** (3.0.4/3.1.1 added in 1.8.0; 3.1.2/3.2.0 *parsing tolerated* since 1.10.4, full 3.2 streaming features not yet supported — [open issue](https://github.com/apple/swift-openapi-generator/issues)).
- Internally converts 3.0.3 → 3.1.0 before generation ([Supported-OpenAPI-features](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Supported-OpenAPI-features.md)).
- **JSON specs are accepted** (`openapi.json` is one of the recognized file names for the plugins; the CLI takes any path). The repo's spec is `"openapi": "3.0.3"` (`apps/web/openapi.json:2`) → fully supported.
- `nullable: true` (3.0-style) is supported; the repo spec uses it 4 times.

## 4. Integration modes: build plugin vs command plugin vs CLI

Source: [Manually-invoking-the-generator-CLI](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Manually-invoking-the-generator-CLI.md), [FAQ](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Frequently-asked-questions.md), [Configuring-the-generator](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Configuring-the-generator.md).

### 4.1 SPM build plugin (Apple's "recommended" default)
- Code generated at build time into the build dir; **never committed**; can't drift from the spec.
- Requires `openapi.yaml|yml|json` **and** `openapi-generator-config.yaml` to live **inside the target's `Sources/` directory** — a real constraint in this monorepo, since the source of truth is `apps/web/openapi.json` (you'd need a copy/sync step anyway, which already erodes the "can't drift" benefit).
- Xcode requires interactive "Trust & Enable" for plugins; CI needs `xcodebuild -skipPackagePluginValidation` or (Xcode Cloud) a `ci_scripts/ci_post_clone.sh` with `defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatatation -bool YES` (misspelling intentional, per FAQ).
- Adds generator build time to clean builds; generated code is hidden in DerivedData (harder to review/debug).
- Determinism: output is a function of the generator version resolved in `Package.resolved` — deterministic **if** the lockfile is committed and CI uses `-onlyUsePackageVersionsFromResolvedFile` / `--force-resolved-versions`.

### 4.2 Command plugin (recommended for this repo)
- `swift package plugin generate-code-from-openapi --target <Target>` writes into `Sources/<Target>/GeneratedSources/`, which **you check into git**. Non-interactive CI invocation: `swift package --allow-writing-to-package-directory generate-code-from-openapi --target <Target>`.
- Pins the generator version via the Swift package's own `Package.swift`/`Package.resolved` (no global tool install), so codegen is reproducible.
- Uses the same `openapi-generator-config.yaml` + spec file in the target dir as the build plugin → a sync script copies `apps/web/openapi.json` into the target before invoking.

### 4.3 Raw CLI
- `swift run swift-openapi-generator generate --mode types --mode client --output-directory <dir> <spec>` from a checkout of the generator repo (or a pinned local SPM "tools" package). Emits `Types.swift` + `Client.swift`. Overwrites silently. Default access modifier of emitted code is `package` when run this way — pass `--access-modifier public|internal` as needed.
- Most flexible (spec path can be anywhere), but you must pin the generator version yourself (e.g., a tiny `Tools/Package.swift` depending on `swift-openapi-generator` exact version, then `swift run`).

### 4.4 In git vs out of git (FAQ's own answer)
- Plugin workflow → generated code stays **out** of git.
- Command plugin / CLI → generated code **checked in** ("for example, for auditing reasons"). Checked-in code still depends on `OpenAPIRuntime` at runtime.
- For this monorepo: **check generated Swift in**. Reasons: (a) reviewers see API-surface diffs in PRs; (b) iOS CI doesn't need to run codegen, only compile; (c) it mirrors the repo's existing pattern — `openapi.json` itself is a checked-in artifact with a drift gate (`apps/web/scripts/check-openapi.ts:1-31`, wired as `openapi:check` in `apps/web/package.json:18`); (d) the web CI (Linux/Bun) can't run Swift codegen, so drift must be checked on a macOS lane anyway.

### 4.5 Generator config that matters
`openapi-generator-config.yaml` keys (from Configuring-the-generator): `generate: [types, client]`, `accessModifier`, `additionalImports`, `additionalFileComments` (e.g. `swiftlint:disable all`, `swift-format-ignore-file`), `filter` (operations/tags/paths — useful to scope a big spec), `namingStrategy: idiomatic` (SOAR-0013; produces idiomatic Swift names instead of defensive `_2`-style; fall back to `defensive` on conflicts), `nameOverrides`, `typeOverrides` (e.g. map a `UUID` schema to `Foundation.UUID`, SOAR-0014).

## 5. Runtime + URLSession transport

- Generated `Client` is transport-agnostic: `Client(serverURL:configuration:transport:middlewares:)`. Use `URLSessionTransport` on iOS:
  ```swift
  let client = Client(
    serverURL: URL(string: "https://openagents.example.com")!, // spec's servers: [{url: "/"}] → supply real base URL at init
    configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
    transport: URLSessionTransport(),
    middlewares: [AuthMiddleware(token: ...)]
  )
  ```
- `URLSessionTransport.Configuration(session:httpBodyProcessingMode:)` — `httpBodyProcessingMode` is `.platformDefault` (streaming on Darwin) or `.buffered`; streaming mode (`URLSessionTransport.swift:64-117` on `main`) drives bodies via URLSession delegate with watermarks. Keep `.platformDefault` for SSE. Pass a custom `URLSession` if you need cookie storage, timeouts (important: default request timeout is 60s — for long-lived SSE set a generous/infinite `timeoutIntervalForRequest` on the session configuration), or background behavior.
- Request/response bodies are `OpenAPIRuntime.HTTPBody` — an `AsyncSequence<ArraySlice<UInt8>>` (SOAR-0004), so large/streaming payloads never buffer by default.

## 6. Auth: middleware, because `securitySchemes` is a no-op

- The generator **does not implement** `security` / `securitySchemes` (explicitly unchecked in [Supported-OpenAPI-features](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Supported-OpenAPI-features.md) — entire Security Scheme Object unsupported). Declaring them in the spec is documentation-only; **auth must be injected client-side**.
- Canonical pattern is a `ClientMiddleware` (official example [auth-client-middleware-example](https://github.com/apple/swift-openapi-generator/blob/main/Examples/auth-client-middleware-example/Sources/AuthenticationClientMiddleware/AuthenticationClientMiddleware.swift)):
  ```swift
  struct AuthenticationMiddleware: ClientMiddleware {
    let value: String
    func intercept(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL,
                   operationID: String,
                   next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?))
                   async throws -> (HTTPResponse, HTTPBody?) {
      var request = request
      request.headerFields[.authorization] = value   // "Bearer <token>" or set .cookie instead
      return try await next(request, body, baseURL)
    }
  }
  ```
- The middleware is `async throws`, so it can lazily fetch/refresh tokens before stamping the header, and can also implement 401-retry (intercept response, refresh, replay `next`). Retrying/logging middleware examples exist in the same Examples dir (`retrying-middleware-example`, `logging-middleware-oslog-example`).
- Repo reality: `apps/web/openapi.json` declares **no** `securitySchemes` (`components: {}` essentially) and its `info.description` says "All endpoints require an authenticated session" — the web app uses better-auth **session cookies**. The iOS auth brief decides cookie vs bearer; either way the mechanism here is a middleware (set `Cookie` header or rely on `URLSession`'s `HTTPCookieStorage` after a sign-in flow).

## 7. Streaming / SSE: supported, with a clear recipe

**Answer: SSE does NOT need to bypass the generated client.** It is an officially documented pattern ([Useful-OpenAPI-patterns — Event streams](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Useful-OpenAPI-patterns.md)):

1. In the spec, give the operation a `text/event-stream` content entry with an empty/binary schema:
   ```yaml
   responses:
     '200':
       content:
         text/event-stream: {}    # raw-bytes HTTPBody in generated code
   ```
   (Any non-JSON content type yields a raw `HTTPBody` byte stream rather than a Codable type.)
2. The generated accessor returns `HTTPBody`; the runtime ships SSE decoders as `AsyncSequence` extensions:
   - `asDecodedServerSentEvents(while:)` → `ServerSentEvent` (string data)
   - `asDecodedServerSentEventsWithJSONData(of:decoder:while:)` → events with `data` decoded as a Codable type; the `while:` predicate handles non-JSON terminators like OpenAI-style `data: [DONE]`.
   - Counterparts exist for JSON Lines (`asDecodedJSONLines(of:)`) and JSON Sequence.
3. Working client code (official [event-streams-client-example](https://github.com/apple/swift-openapi-generator/blob/main/Examples/event-streams-client-example/Sources/EventStreamsClient/EventStreamsClient.swift)):
   ```swift
   let response = try await client.getGreetingsStream(
     headers: .init(accept: [.init(contentType: .textEventStream)]))
   let stream = try response.ok.body.textEventStream
     .asDecodedServerSentEventsWithJSONData(of: Components.Schemas.Greeting.self)
   for try await event in stream { ... }
   ```
4. End-to-end LLM-style SSE through this exact stack was demoed at try! Swift Tokyo 2025 (URLSession transport + ChatGPT SSE): https://www.youtube.com/watch?v=yK__6GF_tvM and the [streaming-chatgpt-proxy example](https://github.com/apple/swift-openapi-generator/tree/main/Examples/streaming-chatgpt-proxy).

Caveats:
- Requires URLSession transport **streaming mode** → iOS 15+ (Section 5); keep `.platformDefault`.
- The SSE event-`data` payloads themselves are **not modeled by the spec** (schema is `{}`); you hand-author Codable Swift types for the event union (for open-agents: the AI SDK UI-message-stream chunk types). Alternative: define the event schema in `components.schemas` purely for reuse, and pass it to `asDecodedServerSentEventsWithJSONData(of:)` — the docs show exactly this pattern.
- **Repo reality:** `apps/web/openapi.json` contains **no** `text/event-stream` anywhere and no chat/session-message endpoints at all (verified by scan). The plan must either (a) extend `lib/api/openapi-spec.ts` with the chat endpoints (response content `text/event-stream: {}`) so the generated client owns the request, or (b) keep chat as a small hand-rolled URLSession layer. Given (a) costs little and keeps auth/middleware/URL handling unified, prefer (a); the SSE chunk decoding is hand-written either way.
- Bidirectional streaming (request body streams) also works (`bidirectional-event-streams-client-example`), though plain POST-then-stream-response covers the chat use case.

## 8. Error and undocumented-status handling

- Every operation's `Output` is a generated `@frozen enum` with one case per documented status plus **`case undocumented(statusCode: Swift.Int, OpenAPIRuntime.UndocumentedPayload)`** (verified in the generator's reference snapshot, `Tests/OpenAPIGeneratorReferenceTests/Resources/ReferenceSources/Petstore/Types.swift:2318`). Undocumented statuses are **values, not thrown errors** — exhaustive `switch` forces handling.
- Convenience throwing accessors: `try response.ok` returns the Ok payload or throws `UnexpectedResponseError`-style runtime error if the case differs — good for "happy path or throw" call sites.
- Transport/serialization failures throw **`ClientError`** (`swift-openapi-runtime/Sources/OpenAPIRuntime/Errors/ClientError.swift:30`) carrying `operationID`, `request`, `response`, `responseBody`, `underlyingError`, `causeDescription` — wrap this once in an app-level error mapper.
- A `default` response in the spec maps to a typed `default` case. The repo's spec documents `200/201/400/401/403/404/409` with a uniform `{ "error": string }` body (`apps/web/lib/api/openapi-spec.ts:50` `errorSchema`) → generated typed error payloads per status; anything else (500s, proxies) lands in `undocumented`. Consider adding a `default` error response to the spec so 5xx bodies are still typed.

## 9. Spec-shape quirks that bite hand-authored specs (and this repo's spec specifically)

Ground truth about `apps/web/openapi.json` (1,544 lines; verified by parsing):
- OpenAPI **3.0.3**; `info.title` "Open Agents API"; `servers: [{url: "/"}]`; only **6 paths / 10 operations** (skills CRUD: `listSkills`/`createSkill`/`updateSkill`/`deleteSkill`; git: `getGitStatus`, `createBranch`, `commitChanges`, `checkPullRequest`, `openPullRequest`, `mergePullRequest`).
- It is **not hand-edited JSON**: it's emitted from Zod 4 schemas via `z.toJSONSchema(schema, { target: "openapi-3.0", io })` in `apps/web/lib/api/openapi-spec.ts:30`, written by `apps/web/scripts/generate-openapi.ts`, drift-gated by `apps/web/scripts/check-openapi.ts` (`openapi:generate` / `openapi:check` in `apps/web/package.json:16-18`). The schemas are the same ones the routes validate with — stronger honesty than a typical hand-maintained spec.

### 9.1 BLOCKING: `additionalProperties: false` (49 occurrences)
Zod's `toJSONSchema` emits `"additionalProperties": false` on every object (49 of 52 occurrences are `false`). swift-openapi-generator honors this strictly: generated `init(from:)` calls `Decoder.ensureNoAdditionalProperties(knownKeys:)`, which **throws `DecodingError` if the server response contains any key not in the spec** (verified in `swift-openapi-runtime/Sources/OpenAPIRuntime/Conversion/CodableExtensions.swift:24-35`). Consequence: the moment the web app adds a response field, every deployed iOS build fails to decode that endpoint. Fix options (pick one, do it before generating):
1. Change `j()` in `openapi-spec.ts` to strip `additionalProperties: false` from **response** (output) schemas (requests can stay strict).
2. Post-process the spec in the iOS codegen script (delete `additionalProperties: false` recursively).
Option 1 is better — it fixes the published contract for all consumers and matches the server's actual "strip unknown keys" semantics.

### 9.2 No `components.schemas` → ugly nested type names
All schemas are inlined per-operation, so generated types are e.g. `Operations.listSkills.Output.Ok.Body.jsonPayload` (or idiomatic-cased equivalents) rather than `Components.Schemas.UserSkill`. The generator supports `components.schemas` fully; **hoist shared shapes (UserSkill, GitStatus, error envelope, PR status) into `components.schemas`** in `openapi-spec.ts` to get reusable, nameable Swift types. (`typeOverrides`/`nameOverrides` only work on named component schemas — another reason to hoist.)

### 9.3 Enums are closed
`source: manual|generated`, PR `status: open|merged|closed`, merge `method: merge|squash|rebase` generate frozen Swift enums; **an unknown value fails decoding**. The documented workaround is the "open enum" pattern — wrap in `anyOf: [enum, string]` ([Useful-OpenAPI-patterns — Open enums and oneOfs](https://github.com/apple/swift-openapi-generator/blob/main/Sources/swift-openapi-generator/Documentation.docc/Articles/Useful-OpenAPI-patterns.md)). Apply it to server-evolvable enums (PR status), accept closure for request-only enums (merge method).

### 9.4 Dates
- `format: date-time` → `Foundation.Date`; default transcoder is **ISO 8601 without fractional seconds** — a classic decode-failure trap when servers emit millisecond timestamps. Use `Configuration(dateTranscoder: .iso8601WithFractionalSeconds)` (verified: `swift-openapi-runtime/Sources/OpenAPIRuntime/Conversion/Configuration.swift:92-101`).
- Repo reality: the spec types `createdAt`/`updatedAt` as **plain strings** (no `format`), so today they arrive as `String` in Swift. Either add `format: date-time` in the Zod→JSON Schema emission (then set the fractional-seconds transcoder) or parse in the app layer. `format: date`, `uuid`, `email` map to `String` unless `typeOverrides` is used.

### 9.5 oneOf/anyOf/allOf
Supported: `allOf`/`anyOf` generate wrapper structs; `oneOf` generates an enum (with discriminator → reference-only children; without → any schemas). The repo spec currently uses **none** of these, so no immediate risk; if discriminated unions get added (e.g. chat chunk types), prefer `oneOf` + `discriminator` for clean Swift enums.

### 9.6 Misc
- JSON Schema validation keywords (`pattern`, `minLength`, `maximum`…) are **ignored** — not enforced client-side.
- `default` values in schemas are ignored (field stays optional).
- Empty schema `{}` → `OpenAPIValueContainer` (untyped JSON).
- The generator runs OpenAPIKit validation on the document at generation time (1.12.x made some validators selective/disabled) — generation itself is a weak spec-validity gate.

## 10. Keeping the spec & server honest (validation + contract testing)

This repo already has the most important gate: the spec is **derived from the route's own Zod validators** with a CI-style drift check (`openapi:check`). Recommended additions, in priority order:

1. **Spec lint in web CI**: Spectral (`npx @stoplight/spectral-cli lint apps/web/openapi.json --ruleset .spectral.yml`) or Redocly CLI (`redocly lint`); vacuum if speed ever matters. Custom rules can enforce "every operation documents 401", "every response object has no `additionalProperties: false`" (guards 9.1 permanently), "shared schemas live in components". Refs: https://github.com/stoplightio/spectral, https://redocly.com/docs/cli/, https://quobix.com/vacuum/about/, https://learn.openapis.org/best-practices.html
2. **Response-validation contract tests**: in the existing Bun route tests, validate actual route responses against `openapi.json` schemas (ajv against the response schema, or extend the existing `apps/web/lib/api/openapi-spec.test.ts`). This catches handler-vs-spec drift that Zod input validation alone can't (output shapes).
3. **Optional deeper layer**: Schemathesis (`schemathesis run --checks all --base-url http://localhost:3002 apps/web/openapi.json`) as a nightly job against a dev server — property-based fuzzing of all documented operations. https://schemathesis.readthedocs.io/
4. **Swift-side drift check** (see workflow below).

## 11. Recommended end-to-end codegen workflow for this monorepo

```
apps/web/lib/api/openapi-spec.ts   (source of truth, Zod)
  └─ bun run --cwd apps/web openapi:generate  → apps/web/openapi.json   [existing]
       └─ ios/Scripts/generate-api.sh:
            1. copy apps/web/openapi.json → ios/Packages/OpenAgentsAPI/Sources/OpenAgentsAPI/openapi.json
               (post-process here if 9.1 isn't fixed at the source)
            2. swift package --package-path ios/Packages/OpenAgentsAPI \
                 --allow-writing-to-package-directory generate-code-from-openapi \
                 --target OpenAgentsAPI
            3. generated files land in Sources/OpenAgentsAPI/GeneratedSources/ (checked in)
```

- `ios/Packages/OpenAgentsAPI` is a local Swift package: depends on `swift-openapi-runtime` (`from: "1.12.0"`) + `swift-openapi-urlsession` (`from: "1.3.0"`); dev-depends on `swift-openapi-generator` (`from: "1.12.2"`) for the command plugin; `openapi-generator-config.yaml` with `generate: [types, client]`, `accessModifier: public`, `namingStrategy: idiomatic`, `additionalFileComments: ["swiftlint:disable all"]`.
- Hand-written companions in the same package (never overwritten — spec-driven workflow guarantees no generated file collides with yours): `AuthenticationMiddleware`, SSE chunk Codable types + decode helpers, error mapper around `ClientError`/`undocumented`.
- **CI drift check (macOS lane)**: run steps 1–2, then `git diff --exit-code -- ios/Packages/OpenAgentsAPI` — exactly mirrors `openapi:check`. Pin codegen determinism by committing the package's `Package.resolved` and building with `--force-resolved-versions`.
- Version bumps of the generator are ordinary PRs whose diff *is* the generated-code change — reviewable.

## 12. Uncertainties

- I did not compile a sample generation against this exact spec; the 9.1/9.2 findings are derived from verified runtime/generator source + the spec's contents, not from an executed codegen run. A 30-minute spike (generate against today's `openapi.json`) should be the first plan task.
- Whether the team wants cookies (better-auth session) vs a token scheme on iOS is out of scope here; both are middleware-compatible.
- `1.12.2` release dates were read from GitHub's releases page rendering without explicit years for the newest entries; sequence-consistency strongly implies 2026 for ≥1.10.4.

## 13. Sources

- https://github.com/apple/swift-openapi-generator (README, releases)
- https://github.com/apple/swift-openapi-runtime (releases, `Conversion/CodableExtensions.swift`, `Conversion/Configuration.swift`, `Errors/ClientError.swift`)
- https://github.com/apple/swift-openapi-urlsession (README, releases, `URLSessionTransport.swift`)
- DocC articles on `main`: Manually-invoking-the-generator-CLI.md, Frequently-asked-questions.md, Configuring-the-generator.md, Supported-OpenAPI-features.md, Useful-OpenAPI-patterns.md
- Examples: auth-client-middleware-example, event-streams-client-example, streaming-chatgpt-proxy
- https://swift.org/blog/swift-openapi-generator-1.0/
- try! Swift Tokyo 2025, "Live coding a streaming ChatGPT client": https://www.youtube.com/watch?v=yK__6GF_tvM
- Spec tooling: https://learn.openapis.org/best-practices.html, https://github.com/stoplightio/spectral, https://redocly.com/docs/cli/, https://quobix.com/vacuum/about/, https://schemathesis.readthedocs.io/
- Repo files: `apps/web/openapi.json`, `apps/web/lib/api/openapi-spec.ts`, `apps/web/scripts/generate-openapi.ts`, `apps/web/scripts/check-openapi.ts`, `apps/web/package.json:16-18`
