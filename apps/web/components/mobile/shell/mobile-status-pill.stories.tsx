import { MobileStatusPill as Component } from "./mobile-status-pill";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Shell/MobileStatusPill",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/shell/mobile-status-pill.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
