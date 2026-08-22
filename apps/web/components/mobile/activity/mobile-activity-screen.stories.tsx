import { MobileActivityScreen as Component } from "./mobile-activity-screen";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Activity/MobileActivityScreen",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/activity/mobile-activity-screen.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
