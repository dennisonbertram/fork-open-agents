import { checkBotId } from "botid/server";
import { isTestAuthEnabled } from "@/lib/session/test-auth";

/**
 * Shared Vercel BotID server-side configuration.
 *
 * `extraAllowedHosts` tells BotID which frontend origins are permitted to
 * call the protected endpoints — anything on our own domains plus Vercel
 * preview / sandbox URLs.
 */
export const botIdConfig = {
  advancedOptions: {
    extraAllowedHosts: [
      "vercel.com",
      "*.vercel.com",
      "*.vercel.dev",
      "*.vercel.run",
      // This fork's production + preview deployments are served on *.vercel.app
      // (e.g. open-agents-*-dennisons-projects.vercel.app). Without this, BotID
      // rejects the frontend origin and every protected call (e.g. creating a
      // session) returns 403 "Access denied" for real users.
      "*.vercel.app",
      "*.open-agents.dev",
    ],
  },
};

export async function checkBotProtection() {
  if (process.env.NODE_ENV !== "production" || isTestAuthEnabled()) {
    return {
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: true,
    };
  }

  return checkBotId(botIdConfig);
}
