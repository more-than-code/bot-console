<script lang="ts">
	import { SUPPORT_EMAIL } from '$lib/site/links';
	import LegalPage from './LegalPage.svelte';
</script>

<LegalPage title="Privacy Policy">
	<p>
		Deploybot (<a href="https://deploybot.dev">deploybot.dev</a>, with the console at
		<a href="https://console2.deploybot.dev">console2.deploybot.dev</a>) lets you catalog, deploy
		and watch services on hosts you run yourself. Deploybot is run by an individual based in New
		Zealand, who is responsible for your personal information under the New Zealand Privacy Act
		2020. This policy explains what we collect, why, and who processes it. Questions go to
		<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.
	</p>

	<h2>What we collect</h2>
	<ul>
		<li>
			<strong>Account details.</strong> When you sign in with Google we receive your name, email address
			and Google account ID. We do not get your Google password.
		</li>
		<li>
			<strong>Projects and members.</strong> The projects you create or join and who is a member of each.
		</li>
		<li>
			<strong>What your hosts send.</strong> The agents on the hosts you enrol send host metrics, process
			lists and the services they discover.
		</li>
		<li>
			<strong>What you configure.</strong> Catalog entries, env sets, files and registry credentials.
			Secret values are encrypted at rest.
		</li>
		<li><strong>History.</strong> Deploy history and an audit log of actions in your projects.</li>
		<li>
			<strong>Technical data.</strong> A session cookie that keeps you signed in, a cookie that remembers
			your theme preference, and request logs kept to run and secure the service.
		</li>
	</ul>
	<p>
		We do not use advertising or tracking cookies, we do not sell your data, and we do not build
		profiles of you for anyone else.
	</p>
	<p>
		Deploybot is not meant for anyone under 16, and we do not knowingly collect personal information
		from them. If you believe someone under 16 has an account, email
		<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a> and we will delete it as described below.
	</p>

	<h2>How we use it</h2>
	<ul>
		<li>To run the service: sign-in, your projects, and the deploys and monitoring you ask for.</li>
		<li>To keep the service secure.</li>
		<li>To find and fix problems.</li>
	</ul>

	<h2>AI agents</h2>
	<p>
		Deploybot itself calls no AI service. If you connect an AI agent or other MCP client, it acts
		with your own access, and what it reads or changes is up to you and that client.
	</p>

	<h2>Who processes your data</h2>
	<ul>
		<li>
			<strong>HostUS</strong> provides the server that runs Deploybot and stores its database.
		</li>
		<li><strong>Google</strong> provides Google sign-in.</li>
		<li>
			<strong>Your own hosts</strong> run the agent and receive what you deploy to them, including the
			env sets, files and credentials those deploys need.
		</li>
	</ul>
	<p>
		Your data is stored and processed in the United States, which may be outside your country.
		Google sign-in may process data in other regions.
	</p>

	<h2>How long we keep it</h2>
	<p>
		We keep your data for as long as your account or the project it belongs to exists. To delete
		your account, email us from the address on the account and we will do so within 30 days. Deleted
		data can remain in database backups and server logs for up to 30 more days before it is
		overwritten.
	</p>

	<h2>Your rights</h2>
	<ul>
		<li>You can view and edit your projects and settings in the console.</li>
		<li>
			You can ask for a copy of your personal information, a correction or its deletion by emailing
			<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.
		</li>
		<li>
			If you are not happy with how we handle your information, you can complain to the
			<a href="https://www.privacy.org.nz">Office of the Privacy Commissioner</a> in New Zealand.
		</li>
	</ul>

	<h2>Changes</h2>
	<p>If we change this policy, we will post the new version on this page with a new date.</p>

	<h2>Contact</h2>
	<p><a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a></p>
</LegalPage>
