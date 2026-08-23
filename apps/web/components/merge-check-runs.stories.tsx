import { CheckRunsList as Component } from "./merge-check-runs";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "MergeCheckRuns",
  component: Component,
  parameters: {
    generatedFrom: "components/merge-check-runs.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
