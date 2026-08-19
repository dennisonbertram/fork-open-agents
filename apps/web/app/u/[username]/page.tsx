import { permanentRedirect } from "next/navigation";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { username } = await params;
  // Avoid the unused-parameter warning; Next.js still passes searchParams.
  void searchParams;
  permanentRedirect(`/${username}`);
}
