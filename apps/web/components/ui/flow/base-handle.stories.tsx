import { BaseHandle as Component } from "./base-handle";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Flow/BaseHandle",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/flow/base-handle.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
