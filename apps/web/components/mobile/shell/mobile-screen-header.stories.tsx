import { MobileScreenHeader as Component } from "./mobile-screen-header";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Shell/MobileScreenHeader",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/shell/mobile-screen-header.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
