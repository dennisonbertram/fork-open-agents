import { Button as Component } from "./button";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Button",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/button.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
