import { LandingFooter as Component } from "./footer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Landing/Footer",
  component: Component,
  parameters: {
    generatedFrom: "components/landing/footer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
