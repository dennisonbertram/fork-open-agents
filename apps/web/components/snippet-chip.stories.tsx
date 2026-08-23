import { SnippetChip as Component } from "./snippet-chip";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SnippetChip",
  component: Component,
  parameters: {
    generatedFrom: "components/snippet-chip.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
