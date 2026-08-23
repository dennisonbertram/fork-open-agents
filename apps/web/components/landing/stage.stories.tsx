import { Stage as Component } from "./stage";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Stage",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/stage.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
