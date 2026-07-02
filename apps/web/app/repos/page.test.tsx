import { describe, expect, mock, test } from "bun:test";

// repos-redirect: `GET /repos` (a guessed/bookmarked URL) must not render
// Next's bare "This page could not be found" 404 — it redirects to
// `/sessions` instead.

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});

mock.module("next/navigation", () => ({ redirect }));

const { default: ReposPage } = await import("./page");

describe("ReposPage", () => {
  test("redirects to /sessions instead of rendering a bare 404", () => {
    expect(() => ReposPage()).toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/sessions");
  });
});
