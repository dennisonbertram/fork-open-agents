import { ContextPathCombobox as Component } from "./context-path-combobox";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ContextPathCombobox",
  component: Component,
  parameters: {
    generatedFrom: "components/context-path-combobox.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
