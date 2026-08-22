import { Window as Component } from "./window";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Window",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/window.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
