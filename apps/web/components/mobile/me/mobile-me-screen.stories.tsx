import { MobileMeScreen as Component } from "./mobile-me-screen";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Me/MobileMeScreen",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/me/mobile-me-screen.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
