import { AuthGuard as Component } from "./auth-guard";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/AuthGuard",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/auth-guard.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
