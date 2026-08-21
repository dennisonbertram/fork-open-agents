/**
 * #1402: Drizzle journal idxs must stay unique and consecutive.
 * Duplicate idxs (e.g. two entries at idx 67) corrupt future
 * `db:generate` baselines even when `db:check` still reports in-sync.
 *
 * Snapshot note (0018): `0018_remove_hybrid_sandbox.sql` is data-only
 * (UPDATE statements, no schema DDL). drizzle-kit has no practical way to
 * regenerate a mid-chain historical snapshot for that case — `db:generate`
 * only emits a snapshot when schema drifts. The committed chain already
 * skips it: `0019_snapshot.json`.prevId === `0017_snapshot.json`.id. Do not
 * hand-invent `0018_snapshot.json`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type JournalEntry = {
  idx: number;
  tag: string;
};

type Journal = {
  entries: JournalEntry[];
};

type SnapshotMeta = {
  id: string;
  prevId: string | null;
};

const metaDir = join(import.meta.dir, "migrations/meta");
const journalPath = join(metaDir, "_journal.json");

function loadJournal(): Journal {
  return JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
}

function loadSnapshot(name: string): SnapshotMeta {
  return JSON.parse(readFileSync(join(metaDir, name), "utf8")) as SnapshotMeta;
}

describe("drizzle migration journal integrity (#1402)", () => {
  test("every journal idx is unique", () => {
    const { entries } = loadJournal();
    const seen = new Map<number, string>();
    const duplicates: string[] = [];

    for (const entry of entries) {
      const previous = seen.get(entry.idx);
      if (previous !== undefined) {
        duplicates.push(
          `idx ${entry.idx} claimed by both ${previous} and ${entry.tag}`,
        );
      } else {
        seen.set(entry.idx, entry.tag);
      }
    }

    expect(duplicates).toEqual([]);
  });

  test("journal idxs are consecutive from 0", () => {
    const { entries } = loadJournal();
    const idxs = entries.map((entry) => entry.idx);

    expect(idxs[0]).toBe(0);
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBe(idxs[i - 1]! + 1);
    }
  });

  test("data-only 0018 intentionally has no snapshot (0019 links to 0017)", () => {
    expect(existsSync(join(metaDir, "0018_snapshot.json"))).toBe(false);
    const snap17 = loadSnapshot("0017_snapshot.json");
    const snap19 = loadSnapshot("0019_snapshot.json");
    expect(snap19.prevId).toBe(snap17.id);
  });
});
