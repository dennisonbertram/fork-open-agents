import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  join(import.meta.dir, "session-chat-content.tsx"),
  "utf8",
);

describe("SessionChatContent composer tools", () => {
  test("renders the compact external tools selector in the desktop composer", () => {
    expect(source).toContain("ComposioToolSelectorCompact");
    expect(source).toContain("updateChatComposioSelection");
    expect(source).toContain("selection={chatInfo.composioSelection}");
  });
});
