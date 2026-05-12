"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  GitPullRequest,
  Loader2,
  ShieldCheck,
  SquareDashedMousePointer,
  XCircle,
} from "lucide-react";

export function VerifiedBuildEventIcon({ eventName }: { eventName: string }) {
  if (eventName.includes("failed")) {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (eventName.includes("completed")) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }
  if (eventName.includes("approval") || eventName.includes("plan")) {
    return <ClipboardList className="h-3.5 w-3.5 text-amber-500" />;
  }
  if (eventName.includes("gate")) {
    return <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />;
  }
  if (eventName.includes("workcell")) {
    return <SquareDashedMousePointer className="h-3.5 w-3.5 text-blue-500" />;
  }
  if (eventName.includes("artifact") || eventName.includes("capsule")) {
    return <FileWarning className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (eventName.includes("pr")) {
    return <GitPullRequest className="h-3.5 w-3.5 text-green-500" />;
  }
  if (eventName.includes("cancel")) {
    return <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />;
  }
  return <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />;
}
