import { StatusEdge as Component } from "./status-edge";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/StatusEdge",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/status-edge.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
