import { LandingFeatures as Component } from "./features";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Features",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/features.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
