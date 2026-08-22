import { DropdownMenu as Component } from "./dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/DropdownMenu",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/dropdown-menu.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
