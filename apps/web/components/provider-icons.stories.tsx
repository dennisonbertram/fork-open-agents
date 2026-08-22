import { ProviderIcon as Component } from "./provider-icons";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ProviderIcons",
  component: Component,
  parameters: {
    generatedFrom: "components/provider-icons.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
