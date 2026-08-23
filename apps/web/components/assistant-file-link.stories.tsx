import { AssistantFileLink as Component } from "./assistant-file-link";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "AssistantFileLink",
  component: Component,
  parameters: {
    generatedFrom: "components/assistant-file-link.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
