import { WriteRenderer as Component } from "./write-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/WriteRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/write-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
