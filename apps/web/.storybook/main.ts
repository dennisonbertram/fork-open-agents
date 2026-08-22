import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  async viteFinal(config) {
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "server-only": fileURLToPath(
            new URL("server-only-stub.ts", import.meta.url),
          ),
          fsevents: fileURLToPath(new URL("fsevents-stub.ts", import.meta.url)),
        },
      },
      build: {
        ...config.build,
        rolldownOptions: {
          ...(config.build as { rolldownOptions?: { external?: unknown[] } })
            ?.rolldownOptions,
          external: [/^chromium-bidi($|\/)/, /^fsevents($|\/)/],
        },
      },
    };
  },
};

export default config;
