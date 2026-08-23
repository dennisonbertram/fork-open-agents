import { Sidebar as Component } from "./sidebar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Sidebar",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/sidebar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
