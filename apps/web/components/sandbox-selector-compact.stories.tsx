import { SandboxSelectorCompact as Component } from "./sandbox-selector-compact";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SandboxSelectorCompact",
  component: Component,
  parameters: {
    generatedFrom: "components/sandbox-selector-compact.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
