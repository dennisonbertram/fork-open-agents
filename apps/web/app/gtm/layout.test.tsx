import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const notFoundCalls: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({
  notFound: () => {
    notFoundCalls.push("not-found");
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const layoutPromise = import("./layout");
const previousExposure = process.env.OPEN_AGENTS_EXPOSE_GTM;

describe("GtmLayout", () => {
  beforeEach(() => {
    delete process.env.OPEN_AGENTS_EXPOSE_GTM;
    notFoundCalls.length = 0;
  });

  afterAll(() => {
    if (previousExposure === undefined) {
      delete process.env.OPEN_AGENTS_EXPOSE_GTM;
    } else {
      process.env.OPEN_AGENTS_EXPOSE_GTM = previousExposure;
    }
  });

  test("returns not found when the GTM product surface is not exposed", async () => {
    const { default: GtmLayout } = await layoutPromise;

    expect(() => GtmLayout({ children: <div>GTM</div> })).toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundCalls).toHaveLength(1);
  });

  test("renders GTM pages only after explicit product exposure", async () => {
    process.env.OPEN_AGENTS_EXPOSE_GTM = "true";
    const { default: GtmLayout } = await layoutPromise;

    const html = renderToStaticMarkup(
      GtmLayout({ children: <div>GTM workspace</div> }),
    );

    expect(html).toContain("GTM workspace");
    expect(notFoundCalls).toHaveLength(0);
  });
});
