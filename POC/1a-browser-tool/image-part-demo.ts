/**
 * Standalone demonstration that the screenshot -> AI SDK image-part path is
 * exact, independent of the browser. Reads a real PNG (the eval artifact),
 * builds both the persisted FileUIPart and the live-stream file chunk, and
 * prints them so you can see the shape the chat renderer consumes.
 *
 * Run: tsx image-part-demo.ts   (run eval.ts first to produce the screenshot)
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScreenshotPart, buildScreenshotStreamChunk } from "./image-part";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const bytes = await readFile(join(__dirname, "evidence", "screenshot.png"));

  const part = buildScreenshotPart({ bytes, mediaType: "image/png", filename: "screenshot.png" });
  const chunk = buildScreenshotStreamChunk({ bytes, mediaType: "image/png" });

  console.log("Persisted FileUIPart (appended to assistant UIMessage.parts):");
  console.log(JSON.stringify({ ...part, url: `${part.url.slice(0, 48)}…(${bytes.byteLength} bytes)` }, null, 2));
  console.log("\nLive stream file UIMessageChunk (writer.write(...)):");
  console.log(JSON.stringify({ ...chunk, url: `${chunk.url.slice(0, 48)}…(${bytes.byteLength} bytes)` }, null, 2));

  // The renderer in apps/web checks: p.type === "file" && p.mediaType?.startsWith("image/")
  const renders = part.type === "file" && part.mediaType.startsWith("image/");
  console.log(`\nWould render via <img src={p.url}/> in shared-chat-content.tsx: ${renders}`);
}

main();
