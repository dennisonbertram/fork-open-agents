import { TaskRenderer as Component } from "./task-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/TaskRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/task-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
