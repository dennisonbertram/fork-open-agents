import { ClosePrDialog as Component } from "./close-pr-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ClosePrDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/close-pr-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
