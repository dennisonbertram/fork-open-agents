import { GitHubReconnectDialog as Component } from "./github-reconnect-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "GithubReconnectDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/github-reconnect-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
