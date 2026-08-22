import { SettingsGroup as Component } from "./settings-group";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/SettingsGroup",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/settings-group.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
