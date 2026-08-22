import { Card as Component } from "./card";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Card",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/card.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
