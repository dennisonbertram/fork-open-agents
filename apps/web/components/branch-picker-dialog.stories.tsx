import { BranchPickerDialog as Component } from "./branch-picker-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "BranchPickerDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/branch-picker-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
