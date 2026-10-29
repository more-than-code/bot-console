// Links for the public site pages (/about, /privacy, /terms). Kept free of app and
// server imports so the pages can later move to a separate static site.

/**
 * The sign-in page, relative so a local or dev console signs in to itself. On deploybot.dev the
 * Caddy apex block redirects every path outside its page allowlist, /signin included, to
 * https://console.deploybot.dev{uri}. Links using it must keep data-sveltekit-reload, so the
 * browser does a full load (and the redirect) instead of a client-side route on the apex.
 */
export const SIGN_IN_URL = '/signin';

export const SUPPORT_EMAIL = 'support@deploybot.dev';

/** Public source repos. Links use main, the latest release (each repo's default branch); dev is work in progress. */
export const REPO_URL = (repo: string) => `https://github.com/more-than-code/${repo}/tree/main`;

/** The product's front-door repo (umbrella README). */
export const GITHUB_URL = 'https://github.com/more-than-code/deploybot';

/** The bot-agent install guide, on main like the repo links. */
export const INSTALL_GUIDE_URL = 'https://github.com/more-than-code/bot-agent/blob/main/docs/install.md';
