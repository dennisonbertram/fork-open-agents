import { NewSessionDialog as Component } from "./new-session-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "NewSessionDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/new-session-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
