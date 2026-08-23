import { HomeSkeleton as Component } from "./home-skeleton";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "HomeSkeleton",
  component: Component,
  parameters: {
    generatedFrom: "components/home-skeleton.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
