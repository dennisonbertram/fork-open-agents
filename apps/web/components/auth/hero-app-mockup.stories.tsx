import { AppMockup as Component } from "./hero-app-mockup";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/HeroAppMockup",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/hero-app-mockup.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
