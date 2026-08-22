import { MessageModelPill as Component } from "./message-model-pill";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "MessageModelPill",
  component: Component,
  parameters: {
    generatedFrom: "components/message-model-pill.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
