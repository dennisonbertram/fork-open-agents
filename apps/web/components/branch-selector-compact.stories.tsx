import { BranchSelectorCompact as Component } from "./branch-selector-compact";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "BranchSelectorCompact",
  component: Component,
  parameters: {
    generatedFrom: "components/branch-selector-compact.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
