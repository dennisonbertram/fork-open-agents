import { Skeleton as Component } from "./skeleton";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Skeleton",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/skeleton.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
