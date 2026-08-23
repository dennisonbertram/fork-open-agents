import { ComposioWorkspaceSettingsPanel as Component } from "./composio-workspace-settings-panel";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ComposioWorkspaceSettingsPanel",
  component: Component,
  parameters: {
    generatedFrom: "components/composio-workspace-settings-panel.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
