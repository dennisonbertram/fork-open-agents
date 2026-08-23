import { BaseNode as Component } from "./base-node";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/BaseNode",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/base-node.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
