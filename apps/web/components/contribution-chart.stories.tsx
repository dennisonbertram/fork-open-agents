import { ContributionChart as Component } from "./contribution-chart";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ContributionChart",
  component: Component,
  parameters: {
    generatedFrom: "components/contribution-chart.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
