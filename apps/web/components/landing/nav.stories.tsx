import { LandingNav as Component } from "./nav";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Nav",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/nav.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
