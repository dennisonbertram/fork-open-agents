import { MobileTabBar as Component } from "./mobile-tab-bar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Shell/MobileTabBar",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/shell/mobile-tab-bar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
