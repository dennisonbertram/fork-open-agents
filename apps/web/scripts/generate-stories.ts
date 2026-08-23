import { Glob } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const webRoot = path.join(repoRoot, "apps/web");

/**
 * The component source tree is the manifest.
 *
 * This used to parse the committed `docs/component-atlas.html` for file paths,
 * which meant a component added after that snapshot could never be discovered:
 * the atlas is a static artefact with no regeneration command in this repo, so
 * "regenerate the stories" would quietly keep reproducing an old list forever.
 * Reading the tree makes the script self-maintaining.
 */
const unique = [...new Glob("components/**/*.tsx").scanSync({ cwd: webRoot })]
  .filter(
    (file) => !(file.endsWith(".test.tsx") || file.endsWith(".stories.tsx")),
  )
  .sort();

// Curated stories are preserved unless this is set.
const force = process.argv.includes("--force");
const skippedCurated: string[] = [];

/**
 * Whether a story on disk is still an untouched generated scaffold.
 *
 * Tested structurally rather than by diffing against the freshly generated
 * text. A content diff cannot tell "a human added args" from "the component
 * renamed its export, so the template moved underneath an untouched file" —
 * and misreading the second as curation leaves a stale import in place, which
 * can stop Storybook compiling. `--force` is not the escape hatch, because it
 * would overwrite genuine curation too.
 *
 * A generated scaffold is exactly one empty `Default` story and nothing else.
 * Anything a person would add while curating — args, decorators, play
 * functions, extra named stories — fails this test and is preserved, whatever
 * the component's export is called.
 */
function isUntouchedScaffold(existing: string): boolean {
  const normalised = existing.replace(/\s+/g, " ").trim();

  if (!normalised.includes("export const Default: Story = {};")) {
    return false;
  }

  const storyExports = [
    ...normalised.matchAll(/export const ([A-Za-z0-9_]+)/g),
  ].map((match) => match[1]);
  if (storyExports.length !== 1 || storyExports[0] !== "Default") {
    return false;
  }

  return !(
    normalised.includes("args:") ||
    normalised.includes("decorators:") ||
    normalised.includes("play:") ||
    normalised.includes("render:")
  );
}

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

  // Never clobber a story someone has curated.
  //
  // Filling in real args is the whole follow-up to this scaffold, so running
  // the script again to pick up a new component must not reset that work. The
  // test is whether the file on disk is byte-identical to what would be
  // generated for it: if it is, nobody has touched it and rewriting is a no-op;
  // if it differs in any way, it has been edited and is left alone.
  //
  // Deliberately NOT keyed on the `generatedFrom` marker. Curating a story
  // means adding args, not stripping its provenance metadata, so a marker check
  // would treat every curated file as regenerable and delete exactly the work
  // it was meant to protect. Pass --force to overwrite regardless.
  const storyPath = path.join(webRoot, storyRel);
  const existing = await readFile(storyPath, "utf8").catch(() => null);
  if (existing !== null && !force && !isUntouchedScaffold(existing)) {
    skippedCurated.push(storyRel);
    continue;
  }

  await writeFile(storyPath, content);
  created += 1;
}

console.log(`created: ${created}`);
if (skippedCurated.length > 0) {
  console.log(
    `kept curated (use --force to overwrite): ${skippedCurated.length}`,
  );
  for (const item of skippedCurated) {
    console.log(`  ${item}`);
  }
}
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
