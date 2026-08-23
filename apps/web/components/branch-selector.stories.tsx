import { BranchSelector as Component } from "./branch-selector";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "BranchSelector",
  component: Component,
  parameters: {
    generatedFrom: "components/branch-selector.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
