import { FileSuggestionsDropdown as Component } from "./file-suggestions-dropdown";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "FileSuggestionsDropdown",
  component: Component,
  parameters: {
    generatedFrom: "components/file-suggestions-dropdown.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
