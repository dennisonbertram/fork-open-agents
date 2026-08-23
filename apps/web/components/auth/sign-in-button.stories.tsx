import { SignInButton as Component } from "./sign-in-button";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Auth/SignInButton",
  component: Component,
  parameters: {
    generatedFrom: "components/auth/sign-in-button.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
