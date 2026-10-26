// Links for the public site pages (/about, /privacy, /terms). Kept free of app and
// server imports so the pages can later move to a separate static site.

/** The production console sign-in page. Absolute so it works from any host. */
export const SIGN_IN_URL = 'https://console.deploybot.dev/signin';

export const SUPPORT_EMAIL = 'support@deploybot.dev';

/** Public source repos. Links use dev: the default branch of bot-agent and bot-console lacks the licence and install guide. */
export const REPO_URL = (repo: string) => `https://github.com/more-than-code/${repo}/tree/dev`;
