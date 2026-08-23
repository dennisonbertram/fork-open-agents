import { SettingsSection as Component } from "./settings-section";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/SettingsSection",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/settings-section.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
