import { TaskGroupView as Component } from "./task-group-view";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "TaskGroupView",
  component: Component,
  parameters: {
    generatedFrom: "components/task-group-view.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
