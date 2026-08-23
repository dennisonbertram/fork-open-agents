import { RepoPickerScopeEmptyState as Component } from "./repo-picker-scope-empty-state";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "RepoPickerScopeEmptyState",
  component: Component,
  parameters: {
    generatedFrom: "components/repo-picker-scope-empty-state.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
