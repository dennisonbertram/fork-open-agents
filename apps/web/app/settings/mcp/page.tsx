import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { McpSection } from "../mcp-section";

export const metadata: Metadata = {
  title: "MCP servers",
  description:
    "Connect Model Context Protocol servers so their tools can be used by your agents.",
};

export default function McpPage() {
  return (
    <>
      <SettingsPageHeader
        title="MCP servers"
        description="Connect Model Context Protocol servers so their tools can be used by your agents."
      />
      <McpSection />
    </>
  );
}
