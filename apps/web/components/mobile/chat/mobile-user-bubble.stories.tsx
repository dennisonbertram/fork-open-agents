import { MobileUserBubble as Component } from "./mobile-user-bubble";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileUserBubble",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-user-bubble.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
