import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { tool, type Tool, type ToolSet } from "ai";
import {
  type McpServerConfig,
  mcpServerConfigSchema,
  type McpSessionSelection,
} from "./types.ts";

/**
 * Tool namespace prefix. Mirrors the de-facto MCP convention used by Claude
 * Code / the wider ecosystem: mcp__<server>__<tool>. Keeps MCP tools from
 * colliding with the agent's built-in tools (read, write, bash, ...) and with
 * Composio tools (COMPOSIO_*).
 */
export function namespacedToolName(serverName: string, toolName: string) {
  return `mcp__${serverName}__${toolName}`;
}

/** Reverse of namespacedToolName; returns null if not an MCP-namespaced name. */
export function parseNamespacedToolName(
  namespaced: string,
): { server: string; tool: string } | null {
  const match = namespaced.match(/^mcp__([a-z0-9_-]+)__(.+)$/);
  if (!match) {
    return null;
  }
  return { server: match[1], tool: match[2] };
}

function buildTransport(config: McpServerConfig): MCPClientConfig["transport"] {
  if (config.transport === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }
  // http (Streamable HTTP) or sse
  return {
    type: config.transport,
    url: config.url,
    headers: config.headers,
  };
}

export interface MountedServer {
  config: McpServerConfig;
  client: MCPClient;
  /** Raw, un-namespaced tools as returned by the MCP server. */
  rawToolNames: string[];
  /** Namespaced tools ready to merge into the agent's ToolSet. */
  tools: ToolSet;
  /** serverInfo as reported during the MCP initialize handshake. */
  serverInfo: MCPClient["serverInfo"];
  /** Optional instructions the server returned during initialize. */
  instructions?: string;
}

/**
 * Connects to one MCP server, discovers its tools, and adapts them into
 * AI-SDK tool definitions with namespaced keys.
 *
 * The AI SDK's `client.tools()` already returns AI-SDK `Tool` objects whose
 * `execute` proxies a `callTool` round trip to the server. We re-key them under
 * the mcp__<server>__<tool> namespace and (optionally) prefix descriptions so
 * the model knows which server a tool belongs to.
 */
export async function mountServer(
  rawConfig: McpServerConfig,
): Promise<MountedServer> {
  const config = mcpServerConfigSchema.parse(rawConfig);

  const client = await createMCPClient({
    transport: buildTransport(config),
    clientName: "open-agents-mcp-client",
    version: "0.1.0",
    onUncaughtError: (error) => {
      // In the real agent this would feed the observability event stream.
      console.error(`[mcp:${config.name}] uncaught transport error:`, error);
    },
  });

  // schemas: "automatic" -> discover input schemas directly from the server.
  const discovered = await client.tools();

  const namespaced: ToolSet = {};
  const rawToolNames: string[] = [];

  for (const [rawName, mcpTool] of Object.entries(discovered)) {
    rawToolNames.push(rawName);
    const key = namespacedToolName(config.name, rawName);
    namespaced[key] = wrapTool(config.name, rawName, mcpTool as Tool);
  }

  return {
    config,
    client,
    rawToolNames,
    tools: namespaced,
    serverInfo: client.serverInfo,
    instructions: client.instructions,
  };
}

/**
 * Wrap an MCP-provided AI-SDK tool so its description carries the server
 * attribution. The underlying execute() (which performs the MCP callTool round
 * trip) is preserved untouched.
 */
function wrapTool(serverName: string, rawName: string, mcpTool: Tool): Tool {
  const baseDescription = mcpTool.description ?? "";
  const description = `[MCP server: ${serverName}] ${baseDescription}`.trim();

  return tool({
    description,
    inputSchema: mcpTool.inputSchema,
    // Preserve the AI SDK's MCP execute (callTool proxy).
    execute: mcpTool.execute,
  } as Parameters<typeof tool>[0]);
}

/**
 * A session-scoped manager that mounts a *set* of MCP servers, exposes the
 * merged namespaced ToolSet to the agent, and owns lifecycle/cleanup.
 *
 * This is the unit the web app would instantiate per chat turn from the
 * session's persisted MCP selection (analogous to resolveComposioToolsForChat).
 */
export class McpSessionClient {
  private mounted: MountedServer[] = [];

  static async mount(
    selection: McpSessionSelection,
  ): Promise<McpSessionClient> {
    const session = new McpSessionClient();
    // Mount sequentially so a single bad server yields a clear, attributable
    // error rather than an opaque Promise.all rejection.
    for (const server of selection.servers) {
      const mountedServer = await mountServer(server);
      session.mounted.push(mountedServer);
    }
    return session;
  }

  /** Merged, namespaced ToolSet across all mounted servers. */
  tools(): ToolSet {
    const all: ToolSet = {};
    for (const server of this.mounted) {
      Object.assign(all, server.tools);
    }
    return all;
  }

  servers(): MountedServer[] {
    return this.mounted;
  }

  /** Total tool count across all servers (for context-budget checks). */
  toolCount(): number {
    return this.mounted.reduce((sum, s) => sum + s.rawToolNames.length, 0);
  }

  /** Close every transport. Always call in a finally block. */
  async close(): Promise<void> {
    await Promise.allSettled(this.mounted.map((s) => s.client.close()));
    this.mounted = [];
  }
}
