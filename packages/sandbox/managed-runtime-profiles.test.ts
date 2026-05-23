import { describe, expect, test } from "bun:test";
import { getManagedRuntimeProfile } from "./managed-runtime-profiles";

describe("managed runtime profiles", () => {
  test("default web profile scopes browser prerequisites to the profile", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );
    const verifyAgentBrowser = profile.verificationCommands.find(
      (command) => command.id === "verify-agent-browser",
    );

    expect(profile.version).toBe("2026-05-23.2");
    expect(profile.expectedTools).toEqual(["bun", "agent-browser"]);
    expect(profile.optionalTools).toEqual(["node", "npm"]);
    expect(installAgentBrowser?.command).toContain(
      "bun install -g agent-browser",
    );
    expect(installAgentBrowser?.command).toContain(
      'rm -f "$profile_bin_dir/agent-browser"',
    );
    expect(installAgentBrowser?.command).toContain(
      "agent-browser-$platform-$agent_browser_arch",
    );
    expect(installAgentBrowser?.command).toContain(
      "agent-browser install --with-deps",
    );
    expect(installAgentBrowser?.command).toContain('exec %s "$@"');
    expect(verifyAgentBrowser?.command).toContain(
      "agent-browser --help >/dev/null",
    );
    expect(verifyAgentBrowser?.command).toContain(
      'test -d "$HOME/.agent-browser/browsers"',
    );
  });
});
