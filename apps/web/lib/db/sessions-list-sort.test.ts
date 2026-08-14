import { beforeAll, describe, expect, test } from "bun:test";

/**
 * `getSessionsWithUnreadByUserId`'s page query is a real drizzle query
 * builder chain against Postgres — there is no test database in this repo's
 * unit-test setup (every other `lib/db/*.test.ts` mocks `./client` with a
 * fake fluent object). `.toSQL()` on a drizzle query compiles to `{ sql,
 * params }` without opening a connection, so it is usable here: set a
 * syntactically valid (but unreachable) `POSTGRES_URL` before importing
 * `./client`, since the `postgres` driver only connects lazily on the first
 * executed query, never at construction or at `.toSQL()` time.
 *
 * This proves the real ORDER BY clause `buildSessionsOrderBy` produces for
 * each supported sort — in particular that every sort ends in a deterministic
 * tiebreaker on `sessions.id`. Without one, Postgres does not guarantee a
 * stable order across separate LIMIT/OFFSET calls when multiple rows share
 * the same primary sort key (exactly the fan-out shape this feature exists
 * for: several sessions created in the same request burst can share an
 * identical `created_at`), so a full paged walk could silently skip or repeat
 * rows across pages (#1184's paging invariant, extended to sorting).
 */
beforeAll(() => {
  process.env.POSTGRES_URL = "postgres://user:pass@127.0.0.1:1/unreachable";
});

const dbModulePromise = import("./client");
const schemaModulePromise = import("./schema");
const sessionsModulePromise = import("./sessions");

function orderByClause(sql: string): string {
  const match = sql.match(/order by (.+)$/i);
  if (!match?.[1]) {
    throw new Error(`No ORDER BY clause found in: ${sql}`);
  }
  return match[1];
}

describe("buildSessionsOrderBy", () => {
  test("created_desc orders by created_at desc, tiebroken by id asc", async () => {
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy } = await sessionsModulePromise;

    const query = db
      .select({ id: sessions.id })
      .from(sessions)
      .orderBy(...buildSessionsOrderBy("created_desc"));

    const clause = orderByClause(query.toSQL().sql);
    expect(clause).toBe('"sessions"."created_at" desc, "sessions"."id" asc');
  });

  test("created_asc orders by created_at asc, tiebroken by id asc", async () => {
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy } = await sessionsModulePromise;

    const query = db
      .select({ id: sessions.id })
      .from(sessions)
      .orderBy(...buildSessionsOrderBy("created_asc"));

    const clause = orderByClause(query.toSQL().sql);
    expect(clause).toBe('"sessions"."created_at" asc, "sessions"."id" asc');
  });

  test("activity_desc orders by the computed last-activity expression desc, tiebroken by id asc", async () => {
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy } = await sessionsModulePromise;

    const query = db
      .select({ id: sessions.id })
      .from(sessions)
      .orderBy(...buildSessionsOrderBy("activity_desc"));

    const clause = orderByClause(query.toSQL().sql);
    expect(clause).toContain("desc");
    expect(clause.endsWith('"sessions"."id" asc')).toBe(true);
    expect(clause.toLowerCase()).toContain("coalesce");
  });

  test("activity_asc orders by the computed last-activity expression asc, tiebroken by id asc", async () => {
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy } = await sessionsModulePromise;

    const query = db
      .select({ id: sessions.id })
      .from(sessions)
      .orderBy(...buildSessionsOrderBy("activity_asc"));

    const clause = orderByClause(query.toSQL().sql);
    expect(clause).toContain("asc");
    expect(clause.endsWith('"sessions"."id" asc')).toBe(true);
    expect(clause.toLowerCase()).toContain("coalesce");
  });

  test("every supported sort ends in a deterministic id tiebreaker — the paging-invariant guard", async () => {
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy, SESSION_SORTS } = await sessionsModulePromise;

    for (const sort of SESSION_SORTS) {
      const query = db
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(...buildSessionsOrderBy(sort));
      const clause = orderByClause(query.toSQL().sql);
      expect(clause.endsWith('"sessions"."id" asc')).toBe(true);
    }
  });
});

describe("regression: buildSessionsOrderBy default-branch guard", () => {
  test("an unrecognized sort value still gets the created_desc id-tiebroken fallback, not an unordered query", async () => {
    // `buildSessionsOrderBy`'s switch has a `default:` case rather than one
    // explicit case per SESSION_SORTS entry (an oxlint no-useless-switch-case
    // rule forbids a redundant "created_desc" case that duplicates default).
    // If a future edit removes that default (e.g. while "cleaning up" the
    // switch, or while adding a 5th sort and forgetting to handle it), a
    // caller passing an unrecognized value gets `undefined` back — spread
    // into `.orderBy()` as `.orderBy(...undefined)`, throwing at the type
    // level, or worse, silently producing an unordered query at the SQL
    // level, which fails the paging invariant for every caller of that sort.
    // This exercises the exact fallback path with a value outside the
    // declared union (cast, since TS itself would already catch a real call
    // site) to prove the safety net is still there.
    const { db } = await dbModulePromise;
    const { sessions } = await schemaModulePromise;
    const { buildSessionsOrderBy } = await sessionsModulePromise;

    const orderBy = buildSessionsOrderBy(
      "not-a-real-sort" as Parameters<typeof buildSessionsOrderBy>[0],
    );
    const query = db
      .select({ id: sessions.id })
      .from(sessions)
      .orderBy(...orderBy);

    const clause = orderByClause(query.toSQL().sql);
    expect(clause).toBe('"sessions"."created_at" desc, "sessions"."id" asc');
  });
});
