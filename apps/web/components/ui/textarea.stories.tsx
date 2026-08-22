import { Textarea as Component } from "./textarea";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Textarea",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/textarea.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
