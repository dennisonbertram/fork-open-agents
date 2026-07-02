import { redirect } from "next/navigation";

// repos-redirect: `/repos` is a guessed/bookmarked URL — a first-run user is
// likely to try it. Redirect to `/sessions` instead of rendering the
// framework's bare "This page could not be found" 404. Auth is still
// enforced by `apps/web/app/repos/layout.tsx`, which redirects unauthenticated
// users to `/` before this page renders.
export default function ReposPage() {
  redirect("/sessions");
}
