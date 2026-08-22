import { MobileComposer as Component } from "./mobile-composer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/Chat/MobileComposer",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/chat/mobile-composer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
