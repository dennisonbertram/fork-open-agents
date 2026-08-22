import { ModelCombobox as Component } from "./model-combobox";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ModelCombobox",
  component: Component,
  parameters: {
    generatedFrom: "components/model-combobox.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
