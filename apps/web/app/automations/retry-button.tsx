"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RetryButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-4"
      onClick={() => router.refresh()}
    >
      Retry this page
    </Button>
  );
}
