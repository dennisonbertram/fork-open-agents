import { MobileChatHeader as Component } from "./mobile-chat-header";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileChatHeader",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-chat-header.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
