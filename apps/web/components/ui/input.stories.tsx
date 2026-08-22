import { Input as Component } from "./input";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Input",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/input.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
