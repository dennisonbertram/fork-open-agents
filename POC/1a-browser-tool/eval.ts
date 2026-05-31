/**
 * POC 1a meaningful eval.
 *
 * Serves the local static fixture over HTTP, drives a REAL headless Chromium
 * through the browser tools (navigate -> click -> type -> extract -> screenshot),
 * asserts on real outcomes, constructs/validates the AI SDK image part, and
 * records timings + artifacts into ./evidence.
 *
 * Run: tsx eval.ts   (after `playwright install chromium`)
 */
import { createServer } from "node:http";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserExtractTool,
  browserScreenshotTool,
  type BrowserToolContext,
} from "./browser-tool";
import { closeBrowserSession, getBrowserSession } from "./browser-session";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(__dirname, "evidence");

const log: string[] = [];
function record(line: string) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  log.push(stamped);
}

let failures = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    record(`PASS  ${label}`);
  } else {
    failures++;
    record(`FAIL  ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`);
  }
}

// Minimal Playwright tool-call invoker: matches how the AI SDK calls execute
// (args, { experimental_context }). We bypass the model and call directly.
// The AI SDK `execute` is optional and may return a value, Promise, or
// AsyncIterable; for the POC every tool resolves to a plain object, so we
// normalize with Promise.resolve and return the union of all tool outputs.
function invoke(
  t: { execute?: (a: never, o: never) => unknown },
  args: unknown,
  context: BrowserToolContext,
): Promise<any> {
  const options = { experimental_context: context, toolCallId: "poc", messages: [] };
  return Promise.resolve(t.execute?.(args as never, options as never));
}

async function main() {
  await mkdir(EVIDENCE, { recursive: true });

  // 1. Serve the fixture.
  const html = await readFile(join(__dirname, "fixtures", "index.html"), "utf-8");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/`;
  record(`Fixture served at ${baseUrl}`);

  // Streamed image parts captured here (proves the live writer path).
  const streamedChunks: Array<{ type: string; mediaType: string; url: string }> = [];
  const context: BrowserToolContext = {
    launch: { headless: true, args: ["--no-sandbox"] },
    writer: { write: (chunk) => streamedChunks.push(chunk) },
  };

  try {
    // 2. Cold start measurement (forces the launch).
    const session = await getBrowserSession(context.launch);
    record(`Chromium cold start: ${session.coldStartMs.toFixed(0)} ms`);
    assert(session.coldStartMs > 0 && session.coldStartMs < 30_000, "cold start within 30s", session.coldStartMs);

    // 3. Navigate.
    const nav = await invoke(browserNavigateTool(), { url: baseUrl }, context);
    record(`navigate -> ${JSON.stringify(nav)}`);
    assert(nav.success === true, "navigate succeeded");
    assert(nav.status === 200, "navigate HTTP 200", nav.status);
    assert(nav.title === "POC 1a Browser Tool Fixture", "page title matches", nav.title);

    // 4. Extract before reveal — secret hidden text still in DOM but div hidden;
    //    extract the heading to prove text extraction works.
    const heading = await invoke(browserExtractTool(), { selector: "#heading" }, context);
    record(`extract #heading -> ${JSON.stringify(heading)}`);
    assert(heading.success === true && heading.text === "Headless Browser POC", "extracted heading text", heading.text);

    // 5. Click the link that reveals the secret div.
    const click = await invoke(browserClickTool(), { selector: "#more" }, context);
    record(`click #more -> ${JSON.stringify(click)}`);
    assert(click.success === true, "click succeeded");

    // 6. Extract the now-visible secret.
    const secret = await invoke(browserExtractTool(), { selector: "#secret" }, context);
    record(`extract #secret -> ${JSON.stringify(secret)}`);
    assert(secret.success === true && secret.text === "the-secret-token-42", "extracted revealed secret", secret.text);

    // 7. Extract an attribute (href).
    const href = await invoke(browserExtractTool(), { selector: "#more", attribute: "id" }, context);
    assert(href.success === true && href.value === "more", "extracted attribute", href.value);

    // 8. Type into the input and read it back.
    const typed = await invoke(browserTypeTool(), { selector: "#name", text: "Ada Lovelace" }, context);
    record(`type #name -> ${JSON.stringify(typed)}`);
    assert(typed.success === true && typed.value === "Ada Lovelace", "typed value round-trips", typed.value);

    // 9. Screenshot -> image part + live stream chunk.
    const shot = await invoke(browserScreenshotTool(), { fullPage: true }, context);
    record(`screenshot -> success=${shot.success} bytes=${shot.byteLength} streamed=${shot.streamed} mediaType=${shot.mediaType}`);
    assert(shot.success === true, "screenshot succeeded");
    assert(shot.byteLength > 1000, "screenshot non-trivial size (>1KB)", shot.byteLength);
    assert(shot.streamed === true, "screenshot streamed via writer");

    // 10. Validate the constructed image part shape.
    const part = shot.imagePart;
    assert(part.type === "file", "image part type=file", part.type);
    assert(part.mediaType === "image/png", "image part mediaType image/png", part.mediaType);
    assert(part.url.startsWith("data:image/png;base64,"), "image part url is png data URL", part.url.slice(0, 32));
    // Decode the data URL back to bytes and confirm PNG magic header.
    const b64 = part.url.split(",", 2)[1] ?? "";
    const decoded = Buffer.from(b64, "base64");
    const pngMagic = decoded.subarray(0, 8).toString("hex");
    assert(pngMagic === "89504e470d0a1a0a", "data URL decodes to valid PNG header", pngMagic);
    assert(decoded.byteLength === shot.byteLength, "decoded bytes match reported byteLength", { decoded: decoded.byteLength, reported: shot.byteLength });

    // 11. Confirm the streamed chunk matches the file UIMessageChunk shape.
    assert(streamedChunks.length === 1, "exactly one chunk streamed", streamedChunks.length);
    const chunk = streamedChunks[0];
    assert(chunk?.type === "file" && typeof chunk.url === "string" && chunk.mediaType === "image/png", "streamed chunk has file shape", chunk);

    // 12. Save artifacts.
    await writeFile(join(EVIDENCE, "screenshot.png"), decoded);
    await writeFile(join(EVIDENCE, "image-part.json"), JSON.stringify({ ...part, url: `${part.url.slice(0, 64)}...<${decoded.byteLength} bytes>` }, null, 2));
    const fileStat = await stat(join(EVIDENCE, "screenshot.png"));
    record(`Saved evidence/screenshot.png (${fileStat.size} bytes)`);
    assert(fileStat.size === decoded.byteLength, "saved screenshot size matches decoded bytes");
  } finally {
    await closeBrowserSession();
    server.close();
  }

  record(failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  await writeFile(join(EVIDENCE, "eval-log.txt"), `${log.join("\n")}\n`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  record(`FATAL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  await mkdir(EVIDENCE, { recursive: true }).catch(() => {});
  await writeFile(join(EVIDENCE, "eval-log.txt"), `${log.join("\n")}\n`).catch(() => {});
  process.exitCode = 1;
});
