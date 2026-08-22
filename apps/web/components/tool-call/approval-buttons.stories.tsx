import { ApprovalButtons as Component } from "./approval-buttons";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/ApprovalButtons",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/approval-buttons.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
