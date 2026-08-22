import { MobileSuggestionChips as Component } from "./mobile-suggestion-chips";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Mobile/New/MobileSuggestionChips",
  component: Component,
  parameters: {
    generatedFrom: "components/mobile/new/mobile-suggestion-chips.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
