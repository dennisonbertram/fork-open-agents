import { headers } from "next/headers";
import { cache } from "react";
import { resolveSessionFromHeaders } from "./resolve-session";
import type { Session } from "./types";

export const getServerSession = cache(
  async (): Promise<Session | undefined> => {
    const requestHeaders = await headers();
    return resolveSessionFromHeaders(requestHeaders);
  },
);
