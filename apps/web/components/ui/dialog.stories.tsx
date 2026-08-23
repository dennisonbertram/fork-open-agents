import { Dialog as Component } from "./dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Dialog",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
