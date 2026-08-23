import { FeatureSandbox as Component } from "./feature-sandbox";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/FeatureSandbox",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/feature-sandbox.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
