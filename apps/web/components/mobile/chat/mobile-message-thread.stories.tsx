import { MobileMessageThread as Component } from "./mobile-message-thread";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileMessageThread",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-message-thread.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
