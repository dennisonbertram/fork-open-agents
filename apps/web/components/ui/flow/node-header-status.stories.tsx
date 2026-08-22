import { NodeHeaderStatus as Component } from "./node-header-status";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/NodeHeaderStatus",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/node-header-status.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
