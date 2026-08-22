import { Tooltip as Component } from "./tooltip";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Tooltip",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/tooltip.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
