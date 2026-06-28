import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const bubbleVariants = cva("flex w-full min-w-0", {
  variants: {
    align: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
    },
    variant: {
      default: "",
      user: "",
      assistant: "",
      system: "",
    },
  },
  defaultVariants: {
    align: "start",
    variant: "default",
  },
});

const bubbleContentVariants = cva(
  "min-w-0 max-w-full whitespace-pre-wrap break-words rounded-3xl px-4 py-2 text-sm",
  {
    variants: {
      align: {
        start: "rounded-tl-sm",
        center: "",
        end: "rounded-tr-sm",
      },
      variant: {
        default: "bg-secondary text-secondary-foreground",
        user: "bg-secondary text-secondary-foreground",
        assistant: "bg-muted text-foreground",
        system: "bg-transparent px-0 py-0 text-muted-foreground",
      },
    },
    defaultVariants: {
      align: "start",
      variant: "default",
    },
  },
);

type BubbleProps = React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    asChild?: boolean;
  };

function Bubble({
  className,
  align,
  variant,
  asChild = false,
  ...props
}: BubbleProps) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble"
      data-align={align}
      data-variant={variant}
      className={cn(bubbleVariants({ align, variant, className }))}
      {...props}
    />
  );
}

type BubbleContentProps = React.ComponentProps<"div"> &
  VariantProps<typeof bubbleContentVariants> & {
    asChild?: boolean;
  };

function BubbleContent({
  className,
  align,
  variant,
  asChild = false,
  ...props
}: BubbleContentProps) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble-content"
      data-align={align}
      data-variant={variant}
      className={cn(bubbleContentVariants({ align, variant, className }))}
      {...props}
    />
  );
}

function BubbleReactions({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble-reactions"
      className={cn("mt-1 flex items-center gap-1", className)}
      {...props}
    />
  );
}

function BubbleGroup({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  );
}

export {
  Bubble,
  BubbleContent,
  BubbleReactions,
  BubbleGroup,
  bubbleVariants,
  bubbleContentVariants,
};
