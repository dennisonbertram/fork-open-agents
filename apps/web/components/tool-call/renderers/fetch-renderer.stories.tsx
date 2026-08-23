import { FetchRenderer as Component } from "./fetch-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/FetchRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/fetch-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
