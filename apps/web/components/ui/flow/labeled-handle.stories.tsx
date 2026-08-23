import { LabeledHandle as Component } from "./labeled-handle";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/LabeledHandle",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/labeled-handle.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
