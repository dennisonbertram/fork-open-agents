import { Calendar as Component } from "./calendar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Calendar",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/calendar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
