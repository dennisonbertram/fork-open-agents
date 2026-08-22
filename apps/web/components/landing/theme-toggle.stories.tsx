import { ThemeToggle as Component } from "./theme-toggle";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/ThemeToggle",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/theme-toggle.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
