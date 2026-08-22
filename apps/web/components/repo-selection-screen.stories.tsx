import { RepoSelectionScreen as Component } from "./repo-selection-screen";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "RepoSelectionScreen",
  component: Component,
  parameters: {
    generatedFrom: "components/repo-selection-screen.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
