import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubStatusNotice } from "./github-status-notice";

// Issue #781: render github=<status> outcomes on /get-started as designed
// inline states instead of a silent no-op.

describe("GitHubStatusNotice", () => {
  test("request_sent: durable pending-approval card, no CTA", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="request_sent" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("approval");
    expect(html.toLowerCase()).toContain("pending");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("/retry");
  });

  test("pending_sync: install detected, sync in progress, refresh affordance", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="pending_sync" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("sync");
    expect(html).toContain('role="status"');
  });

  test("app_not_configured: operator-facing, no user-blame copy", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="app_not_configured" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("administrator");
    expect(html.toLowerCase()).not.toContain("you did");
    expect(html).toContain('role="alert"');
  });

  test("not_linked: recovery CTA to retry connect", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="not_linked" retryHref="/api/github/app/install?next=%2Fget-started" />,
    );
    expect(html).toContain("/api/github/app/install?next=%2Fget-started");
    expect(html.toLowerCase()).toContain("try connecting again");
  });

  test("link_failed: recovery CTA to retry connect", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="link_failed" retryHref="/api/github/app/install?next=%2Fget-started" />,
    );
    expect(html).toContain("/api/github/app/install?next=%2Fget-started");
    expect(html).toContain('role="alert"');
  });

  test("no_action: neutral acknowledgment, not an error", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="no_action" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("no changes");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  test("account_connected: success confirmation", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="account_connected" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("connected");
    expect(html).toContain('role="status"');
  });

  test("app_installed: success confirmation", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="app_installed" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("installed");
    expect(html).toContain('role="status"');
  });

  test("invalid_state: forward-compatible generic copy, no crash", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice status="invalid_state" retryHref="/retry" />,
    );
    expect(html.toLowerCase()).toContain("interrupted");
    expect(html).toContain("/retry");
  });

  test("unrecognized/unknown status renders generic forward-compatible copy instead of throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        <GitHubStatusNotice
          status={"some_future_status" as never}
          retryHref="/retry"
        />,
      ),
    ).not.toThrow();

    const html = renderToStaticMarkup(
      <GitHubStatusNotice
        status={"some_future_status" as never}
        retryHref="/retry"
      />,
    );
    expect(html.toLowerCase()).toContain("interrupted");
  });

  test("missingInstallationId flag adjusts pending_sync copy without crashing", () => {
    const html = renderToStaticMarkup(
      <GitHubStatusNotice
        status="pending_sync"
        retryHref="/retry"
        missingInstallationId
      />,
    );
    expect(html.toLowerCase()).toContain("sync");
  });
});
