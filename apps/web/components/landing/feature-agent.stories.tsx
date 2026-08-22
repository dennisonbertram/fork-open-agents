import { FeatureAgent as Component } from "./feature-agent";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/FeatureAgent",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/feature-agent.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
