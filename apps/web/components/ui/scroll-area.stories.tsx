import { ScrollArea as Component } from "./scroll-area";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/ScrollArea",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/scroll-area.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
