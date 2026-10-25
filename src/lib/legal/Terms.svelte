<script lang="ts">
	import { SUPPORT_EMAIL } from '$lib/site/links';
	import LegalPage from './LegalPage.svelte';
</script>

<LegalPage title="Terms of Service">
	<p>
		These terms apply when you use Deploybot (<a href="https://deploybot.dev">deploybot.dev</a> and
		the console at <a href="https://console.deploybot.dev">console.deploybot.dev</a>). Deploybot
		is run by an individual based in New Zealand. By signing in you agree to these terms. Our
		<a href="/privacy">Privacy Policy</a> explains how we handle your information.
	</p>

	<h2>Who can use Deploybot</h2>
	<p>
		Deploybot is a tool for developers and the people who run servers. You must be at least 16
		years old to use it.
	</p>

	<h2>Early access</h2>
	<p>
		Deploybot is provided as is during an early access period. Features can change, and the service
		can be interrupted or unavailable.
	</p>

	<h2>Your hosts and what you deploy</h2>
	<p>
		You are responsible for the hosts you enrol and for the software you deploy to them, including
		having the right to run it and keeping those hosts secure.
	</p>

	<h2>Acceptable use</h2>
	<p>You agree not to:</p>
	<ul>
		<li>use Deploybot for anything unlawful;</li>
		<li>attack or overload the service, or use it to attack or overload other people's systems;</li>
		<li>access, or try to access, projects you are not a member of.</li>
	</ul>

	<h2>No warranty</h2>
	<p>
		Deploybot is provided without any warranty, express or implied, including that it will be fit
		for a particular purpose, available, or free of errors.
	</p>

	<h2>Limitation of liability</h2>
	<p>
		To the extent the law allows, we are not liable for any loss or damage arising from your use of
		Deploybot, including loss of data, downtime of your services or harm to your hosts.
	</p>

	<h2>Changes to these terms</h2>
	<p>
		We may change these terms. We will post the new version on this page with a new date. If you
		keep using Deploybot after that, the new terms apply.
	</p>

	<h2>Ending your use</h2>
	<p>
		You may stop using Deploybot at any time and ask us to delete your account. We may suspend your
		access if you breach these terms.
	</p>

	<h2>Governing law</h2>
	<p>These terms are governed by the law of New Zealand.</p>

	<h2>Contact</h2>
	<p><a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a></p>
</LegalPage>
