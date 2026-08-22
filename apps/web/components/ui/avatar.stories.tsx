import { Avatar as Component } from "./avatar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Avatar",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/avatar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
