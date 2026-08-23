import { Empty as Component } from "./empty";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Empty",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/empty.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
