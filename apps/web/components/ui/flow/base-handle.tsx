// Ported from simple-ai (https://github.com/Alwurts/simple-ai), MIT © 2025 Alwurts — adapted for open-agents.
import { Handle, type HandleProps } from "@xyflow/react";
import React from "react";
import { cn } from "@/lib/utils";

export const BaseHandle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & HandleProps
>(({ className, ...props }, ref) => (
  <Handle ref={ref} className={cn("", className)} {...props} />
));

BaseHandle.displayName = "BaseHandle";
