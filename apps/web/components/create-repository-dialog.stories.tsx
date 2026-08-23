import { CreateRepositoryDialog as Component } from "./create-repository-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "CreateRepositoryDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/create-repository-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
