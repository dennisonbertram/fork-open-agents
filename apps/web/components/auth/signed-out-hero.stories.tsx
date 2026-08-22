import { SignedOutHero as Component } from "./signed-out-hero";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/SignedOutHero",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/signed-out-hero.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
