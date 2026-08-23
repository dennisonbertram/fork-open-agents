import { Tabs as Component } from "./tabs";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Ui/Tabs",
  component: Component,
  parameters: {
    generatedFrom: "components/ui/tabs.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
