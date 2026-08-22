import { Popover as Component } from "./popover";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Popover",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/popover.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
