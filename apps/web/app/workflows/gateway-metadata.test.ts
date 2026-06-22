import { describe, expect, test } from "bun:test";
import {
  extractGatewayCost,
  extractProviderTokensPerSecond,
} from "./gateway-metadata";

describe("gateway metadata helpers", () => {
  test("extracts gateway cost", () => {
    expect(extractGatewayCost({ gateway: { cost: "0.0025" } })).toBe(0.0025);
  });

  test("extracts provider-reported tokens per second without local averaging", () => {
    expect(
      extractProviderTokensPerSecond({
        fireworks: {
          usage: {
            output_tokens: 56,
            output_tokens_per_second: "42.25",
          },
        },
      }),
    ).toBe(42.25);
  });

  test("returns undefined when provider metadata has tokens but no throughput", () => {
    expect(
      extractProviderTokensPerSecond({
        fireworks: {
          usage: {
            output_tokens: 56,
          },
        },
      }),
    ).toBeUndefined();
  });
});
