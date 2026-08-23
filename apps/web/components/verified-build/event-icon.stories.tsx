import { VerifiedBuildEventIcon as Component } from "./event-icon";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "VerifiedBuild/EventIcon",
  component: Component,
  parameters: {
    generatedFrom: "components/verified-build/event-icon.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
