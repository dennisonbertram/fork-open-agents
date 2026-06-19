import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Honest gate for non-admins reaching /settings/admin directly. Replaces a
 * misleading fake 404 (which returned HTTP 200) with a calm explanation that
 * this area exists but isn't for them — the same convention as the rest of
 * settings. The nav already hides the Admin group; this is defense-in-depth.
 */
export function AdminAccessGate() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert />
        </EmptyMedia>
        <EmptyTitle>Admin tools</EmptyTitle>
        <EmptyDescription>
          This area is for workspace admins. You don&apos;t have access —
          that&apos;s expected for most people.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/profile">Back to settings</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
