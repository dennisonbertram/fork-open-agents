import { TodoRenderer as Component } from "./todo-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/TodoRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/todo-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
