import { WorkspaceNavigation as Component } from "./workspace-navigation";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "WorkspaceNavigation",
  component: Component,
  parameters: {
    generatedFrom: "components/workspace-navigation.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
