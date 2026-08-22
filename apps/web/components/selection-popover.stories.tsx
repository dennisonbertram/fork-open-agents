import { SelectionPopover as Component } from "./selection-popover";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SelectionPopover",
  component: Component,
  parameters: {
    generatedFrom: "components/selection-popover.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
