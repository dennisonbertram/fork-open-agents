#!/usr/bin/env node
/**
 * A tiny, real MCP server (stdio transport) built with the official
 * @modelcontextprotocol/sdk. It exposes two deterministic tools so the eval can
 * assert exact round-trip results:
 *   - add(a, b)   -> a + b
 *   - echo(text)  -> "echo: <text>"
 *
 * Run standalone:  node --experimental-strip-types src/test-server.ts
 * It speaks MCP over stdin/stdout, so it is normally spawned by the client.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "poc-test-server",
  version: "0.1.0",
});

server.registerTool(
  "add",
  {
    title: "Add two numbers",
    description: "Adds two numbers and returns the sum.",
    inputSchema: {
      a: z.number().describe("first addend"),
      b: z.number().describe("second addend"),
    },
  },
  ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  }),
);

server.registerTool(
  "echo",
  {
    title: "Echo text",
    description: "Echoes the provided text back, prefixed with 'echo: '.",
    inputSchema: {
      text: z.string().describe("text to echo"),
    },
  },
  ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive; transport drives the process via stdin.
}

main().catch((error) => {
  console.error("test-server failed:", error);
  process.exit(1);
});
