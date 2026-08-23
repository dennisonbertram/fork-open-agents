import { ButtonGroup as Component } from "./button-group";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/ButtonGroup",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/button-group.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
