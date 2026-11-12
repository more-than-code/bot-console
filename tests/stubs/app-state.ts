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

let status = 200;
let error: { message: string } | null = null;

/** Tests set the status and error an +error.svelte reads, e.g. 404, before `render`. */
export function setPageStatus(next: number, nextError: { message: string } | null = null): void {
	status = next;
	error = nextError;
}

export const page = {
	get url() {
		return current;
	},
	params: {},
	get route() {
		return { id: routeId };
	},
	get status() {
		return status;
	},
	get error() {
		return error;
	},
	data: {},
	form: null,
	state: {}
};

/** No navigation runs during a server render. */
export const navigating = { from: null, to: null, type: null, willUnload: null, delta: null, complete: null };
