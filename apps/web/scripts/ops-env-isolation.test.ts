import { describe, expect, test } from "bun:test";
import {
  compareEnvFingerprints,
  formatEnvIsolationReport,
  parseDotenvValues,
} from "./ops-env-isolation";

describe("ops env isolation", () => {
  test("detects isolation violation for matching critical backing services", () => {
    const results = compareEnvFingerprints({
      production: new Map([["POSTGRES_URL", "postgres://prod"]]),
      compare: new Map([["POSTGRES_URL", "postgres://prod"]]),
      compareEnvironment: "dev",
      names: ["POSTGRES_URL"],
    });
    expect(results[0]?.status).toBe("isolation_violation");
  });

  test("never includes raw values in formatted report", () => {
    const results = compareEnvFingerprints({
      production: new Map([["REDIS_URL", "redis://prod-secret"]]),
      compare: new Map([["REDIS_URL", "redis://dev-secret"]]),
      compareEnvironment: "dev",
      names: ["REDIS_URL"],
    });
    const output = formatEnvIsolationReport({
      compareEnvironment: "dev",
      results,
    });
    expect(output).not.toContain("redis://prod-secret");
    expect(output).not.toContain("redis://dev-secret");
    expect(output).toContain("fingerprints:");
  });

  test("parses dotenv values without comments", () => {
    const values = parseDotenvValues(
      "# hi\nPOSTGRES_URL='postgres://x'\nEMPTY=\n",
    );
    expect(values.get("POSTGRES_URL")).toBe("postgres://x");
    expect(values.get("EMPTY")).toBe("");
  });
});
