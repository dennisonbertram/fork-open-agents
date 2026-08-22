import { ThinkingBlock as Component } from "./thinking-block";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ThinkingBlock",
  component: Component,
  parameters: {
    generatedFrom: "components/thinking-block.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
