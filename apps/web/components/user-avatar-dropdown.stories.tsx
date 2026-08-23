import { UserAvatarDropdown as Component } from "./user-avatar-dropdown";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UserAvatarDropdown",
  component: Component,
  parameters: {
    generatedFrom: "components/user-avatar-dropdown.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
