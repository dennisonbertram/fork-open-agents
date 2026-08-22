import { ModelSelectorCompact as Component } from "./model-selector-compact";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ModelSelectorCompact",
  component: Component,
  parameters: {
    generatedFrom: "components/model-selector-compact.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
