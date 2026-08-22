import { MobileChatScreen as Component } from "./mobile-chat-screen";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileChatScreen",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-chat-screen.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
