import type { SocialNetwork } from "@/modules/settings";

/** Simplified brand glyphs (lucide has no brand icons); currentColor, 20px box. */
export function SocialIcon({ network, className = "size-5" }: { network: SocialNetwork; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (network) {
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "facebook":
      return <svg {...common} fill="currentColor"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4A21 21 0 0 0 14.3 4c-2.3 0-3.8 1.4-3.8 4v2.5H8v3h2.5V21h3Z" /></svg>;
    case "x":
      return <svg {...common} fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>;
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
        </svg>
      );
    case "tiktok":
      return <svg {...common} fill="currentColor"><path d="M16.6 3c.4 2.1 1.7 3.5 3.9 3.7v3a7 7 0 0 1-3.9-1.2v6.3A5.7 5.7 0 1 1 11 9.1v3.1a2.7 2.7 0 1 0 2.6 2.7V3h3Z" /></svg>;
    case "linkedin":
      return (
        <svg {...common} fill="currentColor">
          <path d="M4.5 3A1.5 1.5 0 1 1 3 4.5 1.5 1.5 0 0 1 4.5 3ZM3.2 8.2h2.6V21H3.2V8.2Zm5.3 0H11v1.8h.1a2.7 2.7 0 0 1 2.5-2c2.6 0 3.1 1.7 3.1 4V21h-2.6v-6.3c0-1.5 0-3.4-2.1-3.4s-2.4 1.6-2.4 3.3V21H8.5V8.2Z" />
        </svg>
      );
  }
}
