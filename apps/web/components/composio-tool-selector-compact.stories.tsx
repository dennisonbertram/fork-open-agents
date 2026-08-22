import { ComposioToolSelectorCompact as Component } from "./composio-tool-selector-compact";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ComposioToolSelectorCompact",
  component: Component,
  parameters: {
    generatedFrom: "components/composio-tool-selector-compact.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
