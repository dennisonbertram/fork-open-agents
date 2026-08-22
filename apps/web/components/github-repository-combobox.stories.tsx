import { GitHubRepositoryCombobox as Component } from "./github-repository-combobox";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "GithubRepositoryCombobox",
  component: Component,
  parameters: {
    generatedFrom: "components/github-repository-combobox.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
