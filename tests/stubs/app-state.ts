let current = new URL('http://console.example/');

/** Tests set this before `render`. Components read the same module instance. */
export function setPageUrl(url: string | URL): void {
	current = url instanceof URL ? new URL(url.href) : new URL(url);
}

export const page = {
	get url() {
		return current;
	},
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	form: null,
	state: {}
};
