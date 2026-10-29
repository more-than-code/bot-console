/** The parts of `document` a poller uses to pause while the tab is hidden. */
export type VisibilityDoc = {
	readonly visibilityState: DocumentVisibilityState;
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
};
