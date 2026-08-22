import { GitHubLink as Component } from "./github-link";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/GithubLink",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/github-link.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
