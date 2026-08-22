import { ToolIconStack as Component } from "./tool-icon-stack";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolIconStack",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-icon-stack.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
