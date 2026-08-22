import { ReadinessVerdict as Component } from "./readiness-verdict";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/ReadinessVerdict",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/readiness-verdict.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
