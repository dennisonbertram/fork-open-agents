import { ToolCallsSummaryBar as Component } from "./tool-calls-summary-bar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCallsSummaryBar",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-calls-summary-bar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
