let current = new URL('http://console.example/');

/** Tests set this before `render`. Components read the same module instance. */
export function setPageUrl(url: string | URL): void {
	current = url instanceof URL ? new URL(url.href) : new URL(url);
}

let routeId: string | null = null;

/** Tests set the matched route id, e.g. '/(site)/about', before `render`. */
export function setRouteId(id: string | null): void {
	routeId = id;
}

export const page = {
	get url() {
		return current;
	},
	params: {},
	get route() {
		return { id: routeId };
	},
	status: 200,
	error: null,
	data: {},
	form: null,
	state: {}
};

/** No navigation runs during a server render. */
export const navigating = { from: null, to: null, type: null, willUnload: null, delta: null, complete: null };
