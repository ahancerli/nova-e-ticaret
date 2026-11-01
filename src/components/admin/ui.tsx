import type { ReactNode } from "react"

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ")

export function AdminPageHeader({
	title,
	subtitle,
	actions,
}: {
	title: string
	subtitle?: string
	actions?: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
				{subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</div>
	)
}

export function AdminCard({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<section className={cx("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
			{children}
		</section>
	)
}

export function AdminCardTitle({
	title,
	subtitle,
	actions,
}: {
	title: string
	subtitle?: string
	actions?: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-5 py-4">
			<div>
				<h2 className="text-base font-semibold text-slate-900">{title}</h2>
				{subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
			</div>
			{actions ? <div className="flex items-center gap-2">{actions}</div> : null}
		</div>
	)
}

export function AdminStatCard({
	label,
	value,
	hint,
}: {
	label: string
	value: string
	hint?: string
}) {
	return (
		<AdminCard className="p-5">
			<p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
			<p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
			{hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
		</AdminCard>
	)
}

export function AdminBadge({
	tone = "slate",
	children,
}: {
	tone?: "slate" | "blue" | "green" | "amber" | "red" | "purple"
	children: ReactNode
}) {
	const tones: Record<NonNullable<Parameters<typeof AdminBadge>[0]["tone"]>, string> = {
		slate: "bg-slate-100 text-slate-700",
		blue: "bg-blue-50 text-blue-700",
		green: "bg-emerald-50 text-emerald-700",
		amber: "bg-amber-50 text-amber-700",
		red: "bg-red-50 text-red-700",
		purple: "bg-purple-50 text-purple-700",
	}
	return (
		<span className={cx("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", tones[tone])}>
			{children}
		</span>
	)
}

export function AdminTable({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cx("overflow-x-auto", className)}>
			<table className="w-full min-w-215 text-sm">{children}</table>
		</div>
	)
}
