import { MobileSessionRow as Component } from "./mobile-session-row";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Activity/MobileSessionRow",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/activity/mobile-session-row.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
