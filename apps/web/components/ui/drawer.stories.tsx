import { Drawer as Component } from "./drawer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Drawer",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/drawer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
