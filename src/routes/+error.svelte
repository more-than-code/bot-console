<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} · Pi Monitor</title>
</svelte:head>

<h1>{page.status}</h1>
<p class="sub">{page.error?.message ?? 'Something went wrong'}</p>
<p><a class="back" href="/">Back to cluster</a></p>
