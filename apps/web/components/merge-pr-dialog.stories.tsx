import { MergePrDialog as Component } from "./merge-pr-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "MergePrDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/merge-pr-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
