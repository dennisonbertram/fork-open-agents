import { MergePrDialogActions as Component } from "./merge-pr-dialog-actions";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "MergePrDialogActions",
  component: Component,
  parameters: {
    generatedFrom: "components/merge-pr-dialog-actions.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
