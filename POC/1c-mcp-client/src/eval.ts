/**
 * End-to-end eval for POC 1c (generic MCP client).
 *
 * Proves a real round trip with NO mocks:
 *   1. Mounts a custom stdio MCP server (add/echo) built on the official SDK.
 *   2. Mounts the official @modelcontextprotocol/server-filesystem (stdio).
 *   3. Lists tools and asserts expected tool names appear (namespaced).
 *   4. Calls tools with arguments and asserts exact results:
 *        add(2,3) == 5, echo("hello") == "echo: hello",
 *        filesystem read_text_file of a file we created == its contents.
 *   5. Invokes the adapted tool the way the agent tool loop would: parse args
 *      with the tool's inputSchema, then call tool.execute(args, options).
 *
 * Writes a full transcript to evidence/transcript.txt and a JSON summary.
 */
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { safeValidateTypes } from "@ai-sdk/provider-utils";
import type { Tool } from "ai";
import { McpSessionClient, parseNamespacedToolName } from "./mcp-client.ts";
import type { McpSessionSelection } from "./types.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const lines: string[] = [];
function log(line = "") {
  lines.push(line);
  console.log(line);
}

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    log(`  PASS: ${message}`);
  } else {
    failures += 1;
    log(`  FAIL: ${message}`);
  }
}

/**
 * Extract a flat text result from an MCP CallToolResult-shaped value, matching
 * how the agent would read the tool output.
 */
function resultText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content?: Array<{ type: string; text?: string }> })
      .content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
    }
  }
  return JSON.stringify(value);
}

/**
 * Invoke a tool exactly the way the AI SDK tool loop does:
 *   - validate the model-produced JSON args against tool.inputSchema using the
 *     SDK's own safeValidateTypes (the adapted tool carries an AI-SDK
 *     jsonSchema() schema, not a raw Zod object)
 *   - call tool.execute(parsedArgs, { toolCallId, messages, ... })
 */
async function invokeAsAgentLoop(
  toolName: string,
  tool: Tool,
  rawArgs: unknown,
): Promise<unknown> {
  const validation = await safeValidateTypes({
    value: rawArgs,
    // The adapted tool's inputSchema is an AI-SDK Schema (jsonSchema wrapper).
    schema: tool.inputSchema as Parameters<
      typeof safeValidateTypes
    >[0]["schema"],
  });
  if (!validation.success) {
    throw new Error(
      `args validation failed for ${toolName}: ${validation.error.message}`,
    );
  }
  if (typeof tool.execute !== "function") {
    throw new Error(`tool ${toolName} has no execute()`);
  }
  return tool.execute(validation.value, {
    toolCallId: `eval-${toolName}-${Date.now()}`,
    messages: [],
  });
}

async function main() {
  log("=".repeat(72));
  log("POC 1c — MCP client end-to-end eval");
  log(new Date().toISOString());
  log("=".repeat(72));

  // --- Set up a scratch dir for the filesystem server -------------------
  // Resolve the realpath: on macOS /tmp -> /private/tmp, and the filesystem
  // server enforces its allowed-directory check against the canonical path.
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "mcp-poc-")));
  const sampleFile = join(scratch, "hello.txt");
  const sampleContents = "Hello from POC 1c MCP filesystem round trip!";
  await writeFile(sampleFile, sampleContents, "utf-8");
  log("");
  log(`Scratch dir for filesystem server: ${scratch}`);
  log(`Created sample file: ${sampleFile}`);

  // --- Per-session selection of MCP servers (the persisted config model) -
  const selection: McpSessionSelection = {
    servers: [
      {
        name: "math",
        transport: "stdio",
        command: process.execPath,
        args: ["--experimental-strip-types", join(here, "test-server.ts")],
      },
      {
        name: "fs",
        transport: "stdio",
        command: process.execPath,
        args: [
          join(
            here,
            "..",
            "node_modules",
            "@modelcontextprotocol",
            "server-filesystem",
            "dist",
            "index.js",
          ),
          scratch,
        ],
      },
    ],
  };

  log("");
  log("Mounting MCP servers from session selection:");
  for (const s of selection.servers) {
    log(`  - ${s.name} (${s.transport}): ${"command" in s ? s.command : ""}`);
  }

  const session = await McpSessionClient.mount(selection);
  try {
    // --- 1. CONNECT + serverInfo ---------------------------------------
    log("");
    log("[1] CONNECT — server handshake info");
    for (const server of session.servers()) {
      log(
        `  connected: ${server.config.name} -> ${server.serverInfo.name} v${server.serverInfo.version}`,
      );
    }

    // --- 2. LIST tools --------------------------------------------------
    log("");
    log("[2] LIST — discovered + namespaced tools");
    const allTools = session.tools();
    const toolKeys = Object.keys(allTools).sort();
    for (const key of toolKeys) {
      log(`  ${key}`);
    }
    log(`  total raw tools across servers: ${session.toolCount()}`);

    // Assert expected namespaced names appear.
    assert(
      toolKeys.includes("mcp__math__add"),
      "math server exposes mcp__math__add",
    );
    assert(
      toolKeys.includes("mcp__math__echo"),
      "math server exposes mcp__math__echo",
    );
    const hasFsRead = toolKeys.some(
      (k) => k.startsWith("mcp__fs__") && k.includes("read"),
    );
    assert(hasFsRead, "filesystem server exposes a read_* tool (namespaced)");

    // Namespacing parse round-trips.
    const parsed = parseNamespacedToolName("mcp__math__add");
    assert(
      parsed?.server === "math" && parsed.tool === "add",
      "parseNamespacedToolName('mcp__math__add') -> {math, add}",
    );

    // --- 3. CALL tools directly via adapted execute --------------------
    log("");
    log("[3] CALL — direct round trips");

    const addResult = await invokeAsAgentLoop(
      "mcp__math__add",
      allTools.mcp__math__add as Tool,
      { a: 2, b: 3 },
    );
    log(`  add(2,3) raw -> ${JSON.stringify(addResult)}`);
    assert(resultText(addResult) === "5", "add(2,3) returns 5");

    const echoResult = await invokeAsAgentLoop(
      "mcp__math__echo",
      allTools.mcp__math__echo as Tool,
      { text: "hello" },
    );
    log(`  echo("hello") raw -> ${JSON.stringify(echoResult)}`);
    assert(
      resultText(echoResult) === "echo: hello",
      'echo("hello") returns "echo: hello"',
    );

    // --- 4. CALL the real filesystem server ----------------------------
    log("");
    log("[4] CALL — official filesystem server read round trip");
    const fsReadKey = toolKeys.find(
      (k) => k.startsWith("mcp__fs__") && k.includes("read_text_file"),
    );
    const fsReadFallback = toolKeys.find(
      (k) => k.startsWith("mcp__fs__") && k.includes("read"),
    );
    const readKey = fsReadKey ?? fsReadFallback;
    assert(Boolean(readKey), "found a filesystem read tool to invoke");
    if (readKey) {
      log(`  invoking ${readKey} on ${sampleFile}`);
      // server-filesystem read_text_file takes { path }
      const fsResult = await invokeAsAgentLoop(
        readKey,
        allTools[readKey] as Tool,
        { path: sampleFile },
      );
      const text = resultText(fsResult);
      log(`  read result -> ${JSON.stringify(text)}`);
      assert(
        text.includes(sampleContents),
        "filesystem read returns the contents we wrote",
      );
    }

    // --- 5. Validation guard: bad args are rejected by the SERVER ------
    // NOTE: AI SDK v6 adapts MCP tools with schemas:"automatic" into a
    // jsonSchema() schema that has NO client-side validate() function, so
    // safeValidateTypes passes args through unchecked. The real validation
    // boundary is the MCP server itself (it validates against its own input
    // schema and returns an error result). We assert that protection holds.
    log("");
    log("[5] GUARD — invalid args rejected by the MCP server (round trip)");
    const badResult = await invokeAsAgentLoop(
      "mcp__math__add",
      allTools.mcp__math__add as Tool,
      { a: "not-a-number", b: 3 },
    );
    const badText = resultText(badResult);
    const serverRejected =
      (badResult as { isError?: boolean })?.isError === true ||
      /invalid|expected number|not.*number|error/i.test(badText);
    log(`  add({a:'not-a-number'}) -> ${JSON.stringify(badResult)}`);
    assert(
      serverRejected,
      "server rejects add({a:'not-a-number'}) with an error result",
    );
  } finally {
    // --- 6. CLOSE -------------------------------------------------------
    log("");
    log("[6] CLOSE — tearing down transports");
    await session.close();
    log("  all transports closed");
  }

  log("");
  log("=".repeat(72));
  log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  log("=".repeat(72));

  const transcript = lines.join("\n");
  const evidenceDir = join(here, "..", "evidence");
  await writeFile(join(evidenceDir, "transcript.txt"), `${transcript}\n`, "utf-8");
  await writeFile(
    join(evidenceDir, "summary.json"),
    `${JSON.stringify({ failures, passed: failures === 0, at: new Date().toISOString() }, null, 2)}\n`,
    "utf-8",
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("eval crashed:", error);
  process.exit(1);
});
