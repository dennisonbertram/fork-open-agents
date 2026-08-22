import { GlobRenderer as Component } from "./glob-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/GlobRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/glob-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
