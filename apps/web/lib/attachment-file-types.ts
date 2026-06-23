import { ACCEPT_IMAGE_TYPES } from "@/lib/image-utils";

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "c",
  "css",
  "csv",
  "env",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "py",
  "rb",
  "rs",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export const ACCEPT_ATTACHMENT_TYPES = `${ACCEPT_IMAGE_TYPES},text/*,.csv,.env,.json,.log,.md,.mdx,.toml,.yaml,.yml`;

export function isTextLikeAttachmentFile(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }
  if (
    file.type === "application/json" ||
    file.type === "application/x-ndjson" ||
    file.type === "application/xml"
  ) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? TEXT_ATTACHMENT_EXTENSIONS.has(extension) : false;
}
