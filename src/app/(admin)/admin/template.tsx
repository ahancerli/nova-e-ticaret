// A template remounts on every admin navigation, so each page (and its loading skeleton) eases in.
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
