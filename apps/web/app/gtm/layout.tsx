import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isProductSurfaceExposed } from "@/lib/product-surfaces/config";

export default function GtmLayout({ children }: { children: ReactNode }) {
  if (!isProductSurfaceExposed("gtm")) {
    notFound();
  }

  return children;
}
