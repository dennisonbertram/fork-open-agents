import { AssistantMessageGroups as Component } from "./assistant-message-groups";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "AssistantMessageGroups",
  component: Component,
  parameters: {
    generatedFrom: "components/assistant-message-groups.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
