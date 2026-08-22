import { MobileNewSessionScreen as Component } from "./mobile-new-session-screen";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/New/MobileNewSessionScreen",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/new/mobile-new-session-screen.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
