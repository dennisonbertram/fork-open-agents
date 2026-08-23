import { ToolLayout as Component } from "./tool-layout";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/ToolLayout",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/tool-layout.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
