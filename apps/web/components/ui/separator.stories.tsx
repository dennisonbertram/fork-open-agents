import { Separator as Component } from "./separator";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Separator",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/separator.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
