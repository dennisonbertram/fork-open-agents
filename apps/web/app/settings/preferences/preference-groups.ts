/**
 * Pure data: the 6 concern-based preference group descriptors.
 *
 * Each group carries its title plus any static caption strings used by
 * the corresponding UI group component. Keeping copy here lets us test
 * it independently of the React render tree.
 */

export interface PreferenceGroup {
  /** Sentence-case section title. */
  title: string;
  /** Section-level description shown in the SettingsSection header. */
  description?: string;
  /** Group-specific caption fields consumed by the renderer. */
  caption?: string;
  autoCreatePrCaption?: string;
  alertSoundCaption?: string;
  sandboxVsProfileCaption?: string;
  sandboxHelperCopy?: string;
  manageRuntimeProfilesLink?: string;
  precedenceCaption?: string;
}

export const PREFERENCE_GROUPS: PreferenceGroup[] = [
  {
    title: "Appearance",
    description: "Choose a color theme for the interface.",
    caption:
      "Saved in this browser only — it doesn't follow you to other devices.",
  },
  {
    title: "Defaults for new chats",
    description:
      "Set the sandbox, runtime profile, and diff view used when a new chat starts.",
    sandboxHelperCopy:
      "Vercel is currently the only execution backend; more will appear here as they're added.",
    sandboxVsProfileCaption:
      "The sandbox is where code runs; the runtime profile is the toolchain and setup used when a session provisions one.",
    manageRuntimeProfilesLink: "/settings/runtime-profiles",
  },
  {
    title: "Git automation",
    description:
      "Automate commits and pull requests at the end of each agent turn.",
    autoCreatePrCaption: "Available once Auto commit & push is on.",
  },
  {
    title: "Notifications",
    description: "Control when and how you're alerted.",
    alertSoundCaption: "Plays with each alert.",
  },
  {
    title: "Sharing & privacy",
    description: "Manage your public usage profile and shareable URL.",
  },
  {
    title: "Skills",
    description: "Global skills are loaded for every new session.",
    precedenceCaption:
      "If a repo defines a skill with the same name, the repo's version wins.",
  },
];
