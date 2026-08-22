import { GitHubReconnectGate as Component } from "./github-reconnect-gate";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "GithubReconnectGate",
  component: Component,
  parameters: {
    generatedFrom: "components/github-reconnect-gate.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
