import { TabNav } from "@/components/app/tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-[34px] text-navy-800">Settings</h1>
      <div className="mt-4 border-b border-line">
        <TabNav
          label="Settings sections"
          tabs={[
            { href: "/app/settings", label: "Profile", exact: true },
            { href: "/app/settings/security", label: "Security" },
            { href: "/app/settings/notifications", label: "Notifications" },
            { href: "/app/settings/banks", label: "Connected banks" },
            { href: "/app/settings/privacy", label: "Privacy" },
          ]}
        />
      </div>
      <div className="animate-rise py-6">{children}</div>
    </div>
  );
}
