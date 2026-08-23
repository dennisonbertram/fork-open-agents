import { AuthCtaError as Component } from "./auth-cta-error";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/AuthCtaError",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/auth-cta-error.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
