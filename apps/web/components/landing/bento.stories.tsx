import { LandingBento as Component } from "./bento";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Bento",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/bento.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
