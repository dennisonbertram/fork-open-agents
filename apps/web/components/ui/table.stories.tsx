import { Table as Component } from "./table";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Table",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/table.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
