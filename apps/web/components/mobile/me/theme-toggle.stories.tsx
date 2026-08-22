import { MobileThemeToggle as Component } from "./theme-toggle";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Me/ThemeToggle",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/me/theme-toggle.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
