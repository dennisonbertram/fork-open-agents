import { ReadRenderer as Component } from "./read-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/ReadRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/read-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
