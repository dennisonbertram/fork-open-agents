import { SessionDrawer as Component } from "./session-drawer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SessionDrawer",
  component: Component,
  parameters: {
    generatedFrom: "components/session-drawer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
