import { RepoSelector as Component } from "./repo-selector";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "RepoSelector",
  component: Component,
  parameters: {
    generatedFrom: "components/repo-selector.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
