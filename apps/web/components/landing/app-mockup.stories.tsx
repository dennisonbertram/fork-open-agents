import { AppMockup as Component } from "./app-mockup";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/AppMockup",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/app-mockup.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
