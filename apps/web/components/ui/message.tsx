import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const messageVariants = cva("flex w-full min-w-0 gap-3", {
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

const messageContentVariants = cva("min-w-0", {
  variants: {
    align: {
      start: "items-start text-left",
      center: "items-center text-center",
      end: "items-end text-left",
    },
    variant: {
      default: "",
      user: "",
      assistant: "",
      system: "text-muted-foreground",
    },
  },
  defaultVariants: {
    align: "start",
    variant: "default",
  },
});

type MessageProps = React.ComponentProps<"div"> &
  VariantProps<typeof messageVariants> & {
    asChild?: boolean;
  };

function Message({
  className,
  align,
  variant,
  asChild = false,
  ...props
}: MessageProps) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message"
      data-align={align}
      data-variant={variant}
      className={cn(messageVariants({ align, variant, className }))}
      {...props}
    />
  );
}

function MessageAvatar({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message-avatar"
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

type MessageContentProps = React.ComponentProps<"div"> &
  VariantProps<typeof messageContentVariants> & {
    asChild?: boolean;
  };

function MessageContent({
  className,
  align,
  variant,
  asChild = false,
  ...props
}: MessageContentProps) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message-content"
      data-align={align}
      data-variant={variant}
      className={cn(
        messageContentVariants({ align, variant }),
        "flex flex-col",
        className,
      )}
      {...props}
    />
  );
}

function MessageHeader({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message-header"
      className={cn(
        "mb-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message-footer"
      className={cn(
        "mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function MessageGroup({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageFooter,
  MessageGroup,
  messageVariants,
  messageContentVariants,
};
