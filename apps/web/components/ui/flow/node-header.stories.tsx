import { NodeHeader as Component } from "./node-header";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/NodeHeader",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/node-header.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
