# Product Surface Exposure

Open Agents keeps experimental product entry points hidden unless an operator
explicitly opts them in. Exposure is a product decision; it is separate from
whether the deployment has the runtime capability to execute the feature.

## Default policy

All exposure variables default to `false`. Only the exact string `true` enables
a surface. Values such as `1`, `TRUE`, or an enabled runtime flag do not expose
it.

| Product surface | Exposure variable | Default-off behavior |
| --- | --- | --- |
| Verified Build | `OPEN_AGENTS_EXPOSE_VERIFIED_BUILD` | Sessions use direct chat, the header entry point is hidden, and new run creation returns `product_surface_disabled`. Existing owned run reads remain available. |
| GTM workspace | `OPEN_AGENTS_EXPOSE_GTM` | `/gtm/*` pages return not found. Existing authenticated GTM APIs remain available for diagnostics and future controlled clients. |
| Workflow catalog | `OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG` | The composer picker is hidden without fetching the catalog, and `GET /api/workflows/catalog` returns `product_surface_disabled`. |

These switches are server-only. Client components receive only the resulting
booleans, never environment values.

## Capability versus exposure

Capability flags configure an execution backend. Exposure flags decide whether
ordinary users can discover or create work through that product surface. Both
must be enabled when both concerns apply.

For example, Verified Build creation requires:

```dotenv
HARNESS_ENABLED=true
OPEN_AGENTS_EXPOSE_VERIFIED_BUILD=true
```

`HARNESS_ENABLED=true` by itself intentionally leaves normal Sessions on the
direct chat path. Conversely, exposure does not make an unconfigured harness
healthy; the existing harness configuration checks still fail closed.

## Controlled re-enable procedure

1. Prove the underlying capability using its focused runtime or integration
   checks before changing exposure.
2. Set only the intended `OPEN_AGENTS_EXPOSE_*` variable to the exact string
   `true` in the target environment.
3. Deploy and verify the protected entry point: the UI control appears, the
   creation endpoint succeeds, and the expected runtime evidence is emitted.
4. Verify an unrelated Session still follows its expected direct-chat or
   selected-runtime path.
5. Roll back exposure independently by setting the variable to `false` or
   removing it. This hides new discovery and creation without deleting stored
   run history.

Do not use a runtime capability flag as a shortcut for product exposure. Keeping
the two controls independent makes rollback small and preserves diagnostic
access to records created before a surface was hidden.
