import { AgentConfigFields as Component } from "./agent-config-fields";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "AgentConfigFields",
  component: Component,
  parameters: {
    generatedFrom: "components/agent-config-fields.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
