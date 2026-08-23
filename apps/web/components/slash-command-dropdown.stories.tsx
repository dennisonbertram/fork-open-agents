import { SlashCommandDropdown as Component } from "./slash-command-dropdown";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SlashCommandDropdown",
  component: Component,
  parameters: {
    generatedFrom: "components/slash-command-dropdown.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
