import { SessionStarter as Component } from "./session-starter";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SessionStarter",
  component: Component,
  parameters: {
    generatedFrom: "components/session-starter.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
