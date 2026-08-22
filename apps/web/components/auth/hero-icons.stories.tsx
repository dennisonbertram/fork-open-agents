import { GitHubIcon as Component } from "./hero-icons";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/HeroIcons",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/hero-icons.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
