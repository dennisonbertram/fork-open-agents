import { EditRenderer as Component } from "./edit-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/EditRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/edit-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
