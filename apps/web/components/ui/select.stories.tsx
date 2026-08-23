import { Select as Component } from "./select";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Select",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/select.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
