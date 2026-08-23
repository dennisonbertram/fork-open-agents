import { SessionList as Component } from "./session-list";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SessionList",
  component: Component,
  parameters: {
    generatedFrom: "components/session-list.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
