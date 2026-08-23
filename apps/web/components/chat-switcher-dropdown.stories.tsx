import { ChatSwitcherDropdown as Component } from "./chat-switcher-dropdown";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ChatSwitcherDropdown",
  component: Component,
  parameters: {
    generatedFrom: "components/chat-switcher-dropdown.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
