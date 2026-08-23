import { FeatureWorkflow as Component } from "./feature-workflow";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/FeatureWorkflow",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/feature-workflow.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
