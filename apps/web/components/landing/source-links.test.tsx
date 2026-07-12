import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import DeployYourOwnPage from "@/app/deploy-your-own/page";
import { LandingFooter } from "./footer";
import { GitHubLink } from "./github-link";

const FORK_URL = "https://github.com/dennisonbertram/fork-open-agents";

describe("fork-owned public source links", () => {
  test("landing GitHub links target the maintained fork", () => {
    const html = renderToStaticMarkup(
      <>
        <GitHubLink>Open Source</GitHubLink>
        <LandingFooter />
      </>,
    );

    expect(html.match(new RegExp(FORK_URL, "g"))).toHaveLength(2);
    expect(html).not.toContain("vercel-labs/open-agents");
  });

  test("deploy-your-own clones the maintained fork", () => {
    const html = renderToStaticMarkup(<DeployYourOwnPage />);

    expect(html).toContain(encodeURIComponent(FORK_URL));
    expect(html).not.toContain("vercel-labs%2Fopen-agents");
  });
});
