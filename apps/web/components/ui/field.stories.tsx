import { Field as Component } from "./field";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Field",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/field.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
