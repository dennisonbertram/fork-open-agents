import { AlertDialog as Component } from "./alert-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/AlertDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/alert-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
