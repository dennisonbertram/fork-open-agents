import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const atlasPath = path.join(repoRoot, "docs/component-atlas.html");
const webRoot = path.join(repoRoot, "apps/web");

const atlas = await readFile(atlasPath, "utf8");
const matches = [...atlas.matchAll(/components\/[A-Za-z0-9/_.-]+\.tsx/g)].map(
  (m) => m[0],
);
const unique = [...new Set(matches)].sort();

function pascalize(segment: string): string {
  return segment
    .split(/[-_.]/)
    .flatMap((word) => word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

function detectExport(source: string, fileName: string) {
  const baseName = path.basename(fileName, ".tsx");
  const hasDefault = /^\s*export\s+default/m.test(source);
  if (hasDefault) {
    return { kind: "default", name: null };
  }
  const namedMatches = [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/gm,
    ),
  ].map((m) => m[1]);
  const reExportMatches = [
    ...source.matchAll(/^export\s*\{([^}]*)\}/gm),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((part) => part.trim())
      .map((part) => {
        const aliasMatch = part.match(/^(.+?)\s+as\s+([A-Za-z0-9_]+)$/);
        return aliasMatch ? aliasMatch[2] : part;
      })
      .filter((name) => /^[A-Z]/.test(name)),
  );
  const allNames = [...namedMatches, ...reExportMatches];
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const preferred = allNames.find(
    (name) => normalize(name) === normalize(baseName),
  );
  const chosen = preferred ?? allNames[0];
  return chosen ? { kind: "named", name: chosen } : null;
}

let created = 0;
const skippedMissing: string[] = [];
const skippedNoExport: string[] = [];

for (const rel of unique) {
  const abs = path.join(webRoot, rel);
  let source;
  try {
    source = await readFile(abs, "utf8");
  } catch {
    skippedMissing.push(rel);
    continue;
  }
  if (rel.endsWith(".stories.tsx")) {
    continue;
  }

  const fileName = path.basename(rel);
  const detected = detectExport(source, fileName);
  if (!detected) {
    skippedNoExport.push(rel);
    continue;
  }

  const segments = rel
    .replace(/^components\//, "")
    .replace(/\.tsx$/, "")
    .split("/");
  const fileSegment = segments.at(-1) ?? "";
  const dirSegments = segments.slice(0, -1);
  const title = [...dirSegments.map(pascalize), pascalize(fileSegment)].join(
    "/",
  );

  const storyRel = `${rel.replace(/\.tsx$/, "")}.stories.tsx`;
  const moduleBase = fileName.replace(/\.tsx$/, "");
  const importPath = `./${moduleBase}`;
  const importStatement =
    detected.kind === "default"
      ? `import Component from "${importPath}";`
      : `import { ${detected.name} as Component } from "${importPath}";`;

  const content = `${importStatement}
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "${title}",
  component: Component,
  parameters: {
    generatedFrom: "${rel}",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
`;

  await writeFile(path.join(webRoot, storyRel), content);
  created += 1;
}

console.log(`created: ${created}`);
if (skippedMissing.length > 0) {
  console.log(`missing on disk: ${skippedMissing.length}`);
  for (const item of skippedMissing) {
    console.log(`  ${item}`);
  }
}
if (skippedNoExport.length > 0) {
  console.log(`no detectable component export: ${skippedNoExport.length}`);
  for (const item of skippedNoExport) {
    console.log(`  ${item}`);
  }
}
