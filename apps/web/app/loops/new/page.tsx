import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { LoopCreateForm } from "../loop-create-form";

export const metadata: Metadata = {
  title: "New loop",
  description: "Create a new Agent Loop.",
};

export default async function NewLoopPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <Link
            href="/loops"
            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Loops
          </Link>
          <h1 className="text-2xl font-semibold">New loop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define a multi-step agent workflow using JSON.
          </p>
        </div>
        <LoopCreateForm />
      </div>
    </main>
  );
}
