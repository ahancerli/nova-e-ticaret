/**
 * Height-animated disclosure region (grid-rows 0fr ↔ 1fr, no JS measuring).
 * Closed content is `inert`: hidden from tab order and assistive tech while it stays mounted.
 */
export function Collapsible({ open, children, className = "", id }: { open: boolean; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div
      id={id}
      inert={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"} ${className}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
