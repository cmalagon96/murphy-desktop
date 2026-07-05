import React from "react";
import { FolderClosed, MessageCircle, Phone, Image, Sparkles, Globe } from "lucide-react";

const TILES = [
	{
		id: "chat",
		title: "Family Chat",
		blurb: "Messages, memes, and the group thread",
		icon: MessageCircle,
		accent: "text-murphy-magenta-hi",
		glow: "hover:shadow-[0_10px_40px_rgba(194,24,91,0.25)]",
		tint: "bg-murphy-magenta/15 ring-murphy-magenta/30",
		span: "sm:col-span-2", // featured: chat is the heart of the app
	},
	{
		id: "chat",
		title: "Start a Call",
		blurb: "Voice & video, Discord-style — pick a room and hop in",
		icon: Phone,
		accent: "text-murphy-cyan",
		glow: "hover:shadow-[0_10px_40px_rgba(73,213,200,0.22)]",
		tint: "bg-murphy-cyan/12 ring-murphy-cyan/30",
	},
	{
		id: "files",
		title: "My Files",
		blurb: "Everything you've saved, synced & shared",
		icon: FolderClosed,
		accent: "text-murphy-cyan",
		glow: "hover:shadow-[0_10px_40px_rgba(73,213,200,0.22)]",
		tint: "bg-murphy-cyan/12 ring-murphy-cyan/30",
	},
	{
		id: "photos",
		title: "Photos",
		blurb: "The family album, all in one place",
		icon: Image,
		accent: "text-murphy-magenta-hi",
		glow: "hover:shadow-[0_10px_40px_rgba(194,24,91,0.25)]",
		tint: "bg-murphy-magenta/15 ring-murphy-magenta/30",
	},
	{
		id: "rosie",
		title: "Rosie",
		blurb: "The house brain",
		icon: Sparkles,
		accent: "text-murphy-magenta-hi",
		glow: "hover:shadow-[0_10px_40px_rgba(194,24,91,0.25)]",
		tint: "bg-murphy-magenta/15 ring-murphy-magenta/30",
	},
];

function greeting() {
	const h = new Date().getHours();
	if (h < 5) return "Up late";
	if (h < 12) return "Good morning";
	if (h < 18) return "Good afternoon";
	return "Good evening";
}

export default function Home({ onNavigate }) {
	return (
		<div className="relative h-full overflow-hidden">
			<img
				src="./gojo-vs-sukuna.gif"
				alt=""
				aria-hidden
				draggable="false"
				className="absolute inset-0 h-full w-full object-cover"
			/>
			<div className="murphy-home-overlay absolute inset-0" />
			<div className="relative flex h-full flex-col overflow-y-auto">
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-10 py-12">
				<p className="mb-1 text-lg text-murphy-muted">{greeting()} —</p>
				<h1 className="murphy-gradient-text mb-10 w-fit font-display text-5xl leading-tight font-bold">
					Murphy Cloud
				</h1>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{TILES.map(({ id, title, blurb, icon: Icon, accent, glow, tint, span = "" }) => (
						<button
							key={title}
							onClick={() => onNavigate(id)}
							className={
								span +
								" group flex min-h-[132px] flex-col items-start gap-3 rounded-2xl bg-white/[0.04] p-5 text-left " +
								"ring-1 ring-white/10 outline-none " +
								"motion-safe:transition-all motion-safe:duration-150 " +
								"hover:-translate-y-0.5 hover:bg-white/[0.07] hover:ring-white/20 " +
								"focus-visible:ring-2 focus-visible:ring-murphy-cyan " +
								glow
							}
						>
							<span className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 ${tint}`}>
								<Icon size={22} className={accent} aria-hidden />
							</span>
							<span>
								<span className="block text-lg font-semibold text-murphy-text">{title}</span>
								<span className="mt-0.5 block text-sm text-murphy-muted">{blurb}</span>
							</span>
						</button>
					))}
				</div>
			</div>

				<footer className="flex items-center justify-center gap-2 pb-5 text-xs text-murphy-muted/70">
					<Globe size={12} aria-hidden />
					murphy-cloud.com — your private cloud
				</footer>
			</div>
		</div>
	);
}
