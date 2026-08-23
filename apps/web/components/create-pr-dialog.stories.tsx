import { CreatePRDialog as Component } from "./create-pr-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "CreatePrDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/create-pr-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
