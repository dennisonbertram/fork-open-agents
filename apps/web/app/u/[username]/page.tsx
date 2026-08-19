import { permanentRedirect } from "next/navigation";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { username } = await params;
  const search = await searchParams;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  permanentRedirect(`/${username}${queryString ? `?${queryString}` : ""}`);
}
