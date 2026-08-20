import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SessionNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/50" />
        <h2 className="text-lg font-medium">Session not found</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This session may have been archived or deleted. Open your session list
          to pick another one.
        </p>
      </div>
      <Button asChild>
        <Link href="/sessions">Back to sessions</Link>
      </Button>
    </div>
  );
}
