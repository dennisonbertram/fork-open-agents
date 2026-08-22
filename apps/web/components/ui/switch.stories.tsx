import { Switch as Component } from "./switch";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Switch",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/switch.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
