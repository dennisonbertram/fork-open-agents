import { HeroTerminal as Component } from "./terminal";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Terminal",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/terminal.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
