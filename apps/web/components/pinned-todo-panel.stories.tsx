import { PinnedTodoPanel as Component } from "./pinned-todo-panel";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "PinnedTodoPanel",
  component: Component,
  parameters: {
    generatedFrom: "components/pinned-todo-panel.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
