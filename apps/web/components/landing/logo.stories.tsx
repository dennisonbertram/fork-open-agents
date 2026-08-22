import { Logo as Component } from "./logo";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Logo",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/logo.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
