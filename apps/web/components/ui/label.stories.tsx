import { Label as Component } from "./label";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Label",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/label.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
