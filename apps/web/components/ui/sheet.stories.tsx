import { Sheet as Component } from "./sheet";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Sheet",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/sheet.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
