import { describe, expect, test } from "bun:test";
import {
  ACCEPT_ATTACHMENT_TYPES,
  isTextLikeAttachmentFile,
} from "./attachment-file-types";

describe("attachment file type helpers", () => {
  test("accept string includes images and text-like files for picker parity", () => {
    expect(ACCEPT_ATTACHMENT_TYPES).toContain("image/png");
    expect(ACCEPT_ATTACHMENT_TYPES).toContain("text/*");
    expect(ACCEPT_ATTACHMENT_TYPES).toContain(".md");
  });

  test("classifies text mime types as text attachments", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    expect(isTextLikeAttachmentFile(file)).toBe(true);
  });

  test("classifies common source extensions even without a mime type", () => {
    const file = new File(["console.log('hi')"], "script.ts", { type: "" });

    expect(isTextLikeAttachmentFile(file)).toBe(true);
  });

  test("does not classify arbitrary binary files as text attachments", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "archive.zip", {
      type: "application/zip",
    });

    expect(isTextLikeAttachmentFile(file)).toBe(false);
  });
});
