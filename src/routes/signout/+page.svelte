<script lang="ts">
	import { enhance } from '$app/forms';
</script>

<svelte:head>
	<title>Sign out · deploybot</title>
</svelte:head>

<h1>Sign out</h1>
<p class="sub">This ends the console session on this browser.</p>
<form method="POST" use:enhance>
	<button type="submit">Sign out</button>
</form>
