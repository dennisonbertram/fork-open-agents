import { InputGroup as Component } from "./input-group";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/InputGroup",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/input-group.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
