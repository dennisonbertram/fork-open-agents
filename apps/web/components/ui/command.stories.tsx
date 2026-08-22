import { Command as Component } from "./command";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Command",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/command.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
