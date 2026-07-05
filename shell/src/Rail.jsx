import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { House, FolderClosed, MessageCircle, Phone, Image, Sparkles } from "lucide-react";

export const SECTIONS = [
	{ id: "home", label: "Home", icon: House },
	{ id: "files", label: "Files", icon: FolderClosed },
	{ id: "chat", label: "Family Chat", icon: MessageCircle },
	{ id: "calls", label: "Calls", icon: Phone },
	{ id: "photos", label: "Photos", icon: Image },
	{ id: "rosie", label: "Rosie", icon: Sparkles },
];

function RailButton({ id, label, icon: Icon, active, onNavigate }) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<button
					aria-label={label}
					aria-current={active ? "page" : undefined}
					onClick={() => onNavigate(id)}
					className={
						"group relative flex h-12 w-12 items-center justify-center rounded-2xl outline-none " +
						"motion-safe:transition-all motion-safe:duration-150 " +
						"focus-visible:ring-2 focus-visible:ring-murphy-cyan " +
						(active
							? "bg-murphy-magenta text-white shadow-[0_4px_18px_rgba(194,24,91,0.45)]"
							: "text-murphy-muted hover:rounded-xl hover:bg-white/10 hover:text-murphy-text")
					}
				>
					{/* Discord-style active pill on the rail's left edge */}
					<span
						className={
							"absolute -left-3 w-1 rounded-r-full bg-gradient-to-b from-murphy-magenta-hi to-murphy-cyan " +
							"motion-safe:transition-all motion-safe:duration-200 " +
							(active ? "h-8 opacity-100" : "h-0 opacity-0 group-hover:h-4 group-hover:opacity-70")
						}
					/>
					<Icon size={22} strokeWidth={2.1} aria-hidden />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					side="right"
					sideOffset={10}
					className="rounded-lg bg-murphy-ink-2 px-3 py-1.5 text-sm font-medium text-murphy-text shadow-xl ring-1 ring-white/10"
				>
					{label}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

export default function Rail({ section, onNavigate }) {
	return (
		<nav aria-label="Murphy Cloud sections" className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-murphy-ink py-3 pl-3 pr-0">
			<img src="./face.svg" alt="" className="mb-2 h-11 w-11 rounded-full" draggable="false" />
			<div className="mb-1 h-px w-8 bg-white/10" />
			{SECTIONS.map((s) => (
				<RailButton key={s.id} {...s} active={section === s.id} onNavigate={onNavigate} />
			))}
		</nav>
	);
}
