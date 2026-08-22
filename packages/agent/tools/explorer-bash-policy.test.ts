/**
 * #1401 — Explorer bash read-only policy unit tests.
 *
 * Redirection detection must be quote-aware and whitespace-independent:
 * `echo x>f` (no space) is still a mutating redirect, quoted "a > b"
 * arguments are not redirects, and `2>&1` fd duplication stays read-only.
 */

import { describe, expect, test } from "bun:test";
import { classifyExplorerBashCommand } from "./explorer-bash-policy";

function expectDenied(command: string) {
  const decision = classifyExplorerBashCommand(command);
  expect(decision.allowed).toBe(false);
  if (!decision.allowed) {
    expect(decision.errorKind).toBe("tool_policy_denied");
    expect(decision.reason).toBe("explorer_readonly");
  }
}

function expectAllowed(command: string) {
  const decision = classifyExplorerBashCommand(command);
  expect(decision.allowed).toBe(true);
}

describe("explorer bash policy: redirect detection (#1401)", () => {
  test("denies space-less redirect echo x>f", () => {
    expectDenied("echo x>f");
  });

  test("denies append redirect with spaces", () => {
    expectDenied("echo x >> f");
  });

  test("denies redirect from non-echo heads like cat/grep", () => {
    expectDenied("cat a>f");
    expectDenied("grep a b>f");
    expectDenied("ls >out.txt");
  });

  test("allows fd duplication 2>&1", () => {
    expectAllowed("grep a b 2>&1");
    expectAllowed("ls -la 2>&1 | head -5");
  });

  test("allows quoted > inside arguments", () => {
    expectAllowed('grep "a > b" file');
    expectAllowed("grep 'a > b' file");
    expectAllowed('echo "a > b"');
  });

  test("still denies plain redirection after quoted args", () => {
    expectDenied('grep "a > b" file > out');
  });
});

describe("explorer bash policy: interpreter allowlist (#1401)", () => {
  test("denies awk invocations (system() escape hatch)", () => {
    expectDenied("awk '{print $1}' file");
    expectDenied("cat f | awk '{print $2}'");
  });

  test("denies ad-hoc interpreters", () => {
    expectDenied('python3 -c \'open("f","w").write("x")\'');
    expectDenied("python -c 'print(1)'");
    expectDenied("perl -e 'print 1'");
    expectDenied("ruby -e 'puts 1'");
  });

  test("keeps core read-only filters allowed", () => {
    expectAllowed("sort f | uniq -c");
    expectAllowed("cut -d, -f1 data.csv");
    expectAllowed("sed -n '1,10p' file.ts");
  });
});
