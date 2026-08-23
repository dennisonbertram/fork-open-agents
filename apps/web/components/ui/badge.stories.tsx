import { Badge as Component } from "./badge";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Badge",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/badge.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
