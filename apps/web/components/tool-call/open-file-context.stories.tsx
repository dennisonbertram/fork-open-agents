import { OpenFileProvider as Component } from "./open-file-context";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/OpenFileContext",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/open-file-context.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
