import { MobileActivityFilterChips as Component } from "./mobile-activity-filter-chips";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Activity/MobileActivityFilterChips",
  component: Component,
  parameters: {
    generatedFrom:
      "components/mobile/activity/mobile-activity-filter-chips.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
