import { FileNamePill as Component } from "./file-name-pill";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/FileNamePill",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/file-name-pill.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
