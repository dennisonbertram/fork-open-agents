import { RepoSelectorCompact as Component } from "./repo-selector-compact";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "RepoSelectorCompact",
  component: Component,
  parameters: {
    generatedFrom: "components/repo-selector-compact.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
