import { SettingsPageHeader } from "@/components/ui/settings-section";
import { ProfileContent } from "./profile-content";

export const metadata = {
  title: "Profile",
  description:
    "Review your identity, activity, usage, and leaderboard position.",
};

export default function ProfilePage() {
  return (
    <>
      <SettingsPageHeader
        title="Profile"
        description="Review your identity, activity, usage, and leaderboard position."
      />
      <ProfileContent />
    </>
  );
}
