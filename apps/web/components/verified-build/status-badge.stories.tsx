import { VerifiedBuildStatusBadge as Component } from "./status-badge";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "VerifiedBuild/StatusBadge",
  component: Component,
  parameters: {
    generatedFrom: "components/verified-build/status-badge.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
