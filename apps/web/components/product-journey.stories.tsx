import { ProductJourney as Component } from "./product-journey";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ProductJourney",
  component: Component,
  parameters: {
    generatedFrom: "components/product-journey.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
