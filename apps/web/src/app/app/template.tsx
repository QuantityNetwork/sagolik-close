/** Re-mounts on every in-app navigation, so each page settles in gently. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}
