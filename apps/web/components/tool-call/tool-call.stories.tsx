import { ToolCall as Component } from "./tool-call";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/ToolCall",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/tool-call.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
