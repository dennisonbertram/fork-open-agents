import { DateRangePicker as Component } from "./date-range-picker";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/DateRangePicker",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/date-range-picker.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
