import { describe, expect, it } from "bun:test";
import { parseChatRequestBody } from "./request";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("parseChatRequestBody", () => {
  it("returns ok:false with 400 and error mentioning 'messages' for empty body {}", async () => {
    const result = await parseChatRequestBody(makeRequest({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { error: string };
      expect(json.error.toLowerCase()).toContain("messages");
    }
  });

  it("returns ok:false with 400 for messages as a string", async () => {
    const result = await parseChatRequestBody(makeRequest({ messages: "x" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { error: string };
      expect(json.error.toLowerCase()).toContain("messages");
    }
  });

  it("returns ok:false with 400 for messages as an empty array", async () => {
    const result = await parseChatRequestBody(makeRequest({ messages: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { error: string };
      expect(json.error.toLowerCase()).toContain("messages");
    }
  });

  it("returns ok:true for a valid body with a non-empty messages array", async () => {
    const result = await parseChatRequestBody(
      makeRequest({ messages: [{ role: "user", parts: [] }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.messages).toHaveLength(1);
    }
  });

  it("returns ok:false with 400 for the JSON literal null body", async () => {
    const result = await parseChatRequestBody(makeRawRequest("null"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { error: string };
      expect(json.error.toLowerCase()).toContain("messages");
    }
  });

  it("returns ok:false with 400 for JSON boolean true body", async () => {
    const result = await parseChatRequestBody(makeRawRequest("true"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("returns ok:false with 400 for JSON number body", async () => {
    const result = await parseChatRequestBody(makeRawRequest("123"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("returns ok:false with 400 for JSON string body", async () => {
    const result = await parseChatRequestBody(makeRawRequest('"hello"'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });
});
