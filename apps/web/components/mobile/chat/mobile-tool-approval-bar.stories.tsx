import { MobileToolApprovalBar as Component } from "./mobile-tool-approval-bar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileToolApprovalBar",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-tool-approval-bar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
