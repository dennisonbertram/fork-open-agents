import { GrepRenderer as Component } from "./grep-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/GrepRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/grep-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
