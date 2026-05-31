import type { FileUIPart } from "ai";

/**
 * AI SDK v6 (6.0.168) image/file streaming shapes.
 *
 * Two related shapes are involved when a tool wants a screenshot to render in
 * chat:
 *
 *  1. `FileUIPart` — the persisted part on a `UIMessage`. The web app already
 *     renders this: see `apps/web/app/shared/[shareId]/shared-chat-content.tsx`
 *     (`p.type === "file" && p.mediaType?.startsWith("image/")` -> <img src={p.url} />).
 *
 *        { type: "file"; mediaType: string; filename?: string; url: string }
 *
 *  2. The file `UIMessageChunk` written to the live stream via
 *     `writer.write(...)` (createUIMessageStream). At the chunk level the shape
 *     is narrower — no `filename`:
 *
 *        { type: "file"; url: string; mediaType: string }
 *
 * The `url` is either a hosted URL or a Data URL
 * (data:<mediaType>;base64,<base64>). For an ephemeral screenshot the Data URL
 * is the zero-infrastructure path: no blob upload, renders directly in <img>.
 */

export type ScreenshotImagePart = FileUIPart & {
  mediaType: `image/${string}`;
  url: `data:image/${string};base64,${string}`;
};

/** The exact object you'd hand to `writer.write(...)` on the live stream. */
export type FileStreamChunk = {
  type: "file";
  url: string;
  mediaType: string;
};

export function toDataUrl(bytes: Buffer | Uint8Array, mediaType: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mediaType};base64,${base64}`;
}

/**
 * Build the persisted FileUIPart for a screenshot. This is what would be
 * appended to the assistant UIMessage's `parts` array.
 */
export function buildScreenshotPart(params: {
  bytes: Buffer | Uint8Array;
  mediaType?: string;
  filename?: string;
}): ScreenshotImagePart {
  const mediaType = (params.mediaType ?? "image/png") as `image/${string}`;
  return {
    type: "file",
    mediaType,
    ...(params.filename ? { filename: params.filename } : {}),
    url: toDataUrl(params.bytes, mediaType) as ScreenshotImagePart["url"],
  };
}

/**
 * Build the live-stream file chunk (what `writer.write` accepts). Strips
 * `filename`, which the chunk schema does not carry.
 */
export function buildScreenshotStreamChunk(params: {
  bytes: Buffer | Uint8Array;
  mediaType?: string;
}): FileStreamChunk {
  const mediaType = params.mediaType ?? "image/png";
  return {
    type: "file",
    url: toDataUrl(params.bytes, mediaType),
    mediaType,
  };
}
