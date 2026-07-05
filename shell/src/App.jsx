import React, { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import Rail from "./Rail.jsx";
import Home from "./Home.jsx";

export default function App() {
	const [section, setSection] = useState("home");

	useEffect(() => {
		window.murphy?.onSection(setSection);
	}, []);

	const navigate = (s) => {
		setSection(s);
		window.murphy?.navigate(s);
	};

	return (
		<Tooltip.Provider delayDuration={150}>
			<div className="flex h-full">
				<Rail section={section} onNavigate={navigate} />
				{/* Content area: panes are native WebContentsViews layered above this
				    region by the main process; the shell only renders Home here. */}
				<main className="min-w-0 flex-1">{section === "home" && <Home onNavigate={navigate} />}</main>
			</div>
		</Tooltip.Provider>
	);
}
