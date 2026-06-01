/**
 * Image part helpers for the browser screenshot tool.
 *
 * Provides two shapes as required by the AI SDK / chat renderer:
 *
 * 1. `FileUIPart` — the persisted part on a UIMessage. The web app renders
 *    this at shared-chat-content.tsx line 466:
 *    `p.type === "file" && p.mediaType?.startsWith("image/")` → <img src={p.url} />
 *
 *    Shape: { type: "file"; mediaType: string; filename?: string; url: string }
 *
 * 2. The file UIMessageChunk written to the live stream via writer.write(...).
 *    No `filename` at the chunk level:
 *    { type: "file"; url: string; mediaType: string }
 *
 * The `url` is a Data URL (data:<mediaType>;base64,<base64>) — zero-infra path,
 * renders directly in <img> without blob upload.
 */

import type { FileUIPart } from "ai";

export type ScreenshotImagePart = FileUIPart & {
  mediaType: `image/${string}`;
  url: `data:image/${string};base64,${string}`;
};

export type FileStreamChunk = {
  type: "file";
  url: string;
  mediaType: string;
};

export function toDataUrl(
  bytes: Buffer | Uint8Array,
  mediaType: string,
): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mediaType};base64,${base64}`;
}

/**
 * Build the persisted FileUIPart for a screenshot.
 * This is appended to the assistant UIMessage's parts array.
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
 * Build the live-stream file chunk (what writer.write accepts).
 * Strips `filename` — the chunk schema does not carry it.
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
