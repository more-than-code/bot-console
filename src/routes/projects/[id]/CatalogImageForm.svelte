<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { tick, untrack, type Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Combobox from '$lib/components/ui/combobox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Textarea from '$lib/components/Textarea.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import type { ImageEntry } from '$lib/api-types';
	import {
		DEFAULT_LOG_FILES,
		DEFAULT_LOG_SIZE_MB,
		HEALTH_POLICY_DEFAULTS,
		SUGGESTED_MEMORY_MB,
		applyDockerPaste,
		blankImageDraft,
		dockerRunPreview,
		imageSpecFromDraft,
		loggingForPreview,
		parseDockerRun,
		resolveHealthPolicy,
		setPortPublic,
		storedHealthKeys,
		type ImageDraft,
		type KnownSet
	} from '$lib/image-spec';
	import {
		TAGS_LOADING,
		filterTags,
		imageDescribedBy,
		imageRepository,
		moreLabel,
		tagLookupMessage,
		tagQuery,
		tagAnnouncement,
		taggedRef,
		type ImageDigestResult,
		type ImageTagsResult
	} from '$lib/image-tags';
	import { ImageTagLookup } from '$lib/image-tag-lookup';
	import { settleImageForm, type DialogOutcome } from '$lib/dialog-open';
	import type { ImageEditorState } from '$lib/project-action';
	import ImageLookupPost from './ImageLookupPost.svelte';
	import ImageTagNotes from './ImageTagNotes.svelte';

	let {
		mode,
		entry = null,
		saveAction,
		sets,
		setsMessage = null,
		setsStatus = 'loading',
		retrySets,
		files = [],
		filesMessage = null,
		filesStatus = 'loading',
		retryFiles,
		editor = null,
		tagsAction = null,
		digestAction = null,
		onSettled,
		cancel
	}: {
		mode: 'create' | 'edit';
		entry?: ImageEntry | null;
		saveAction: string;
		sets: KnownSet[];
		setsMessage?: string | null;
		setsStatus?: 'loading' | 'ready' | 'error';
		retrySets?: () => void;
		files?: Array<{ name: string }>;
		filesMessage?: string | null;
		filesStatus?: 'loading' | 'ready' | 'error';
		retryFiles?: () => void;
		editor?: ImageEditorState | null;
		/** `?/catalogImageTags`. Without it the Image field never lists tags. */
		tagsAction?: string | null;
		/** `?/catalogImageDigest`. Without it a picked tag is not pinned. */
		digestAction?: string | null;
		onSettled?: (outcome: DialogOutcome, name: string) => void | Promise<void>;
		cancel?: Snippet;
	} = $props();

	function fromEntry(item: ImageEntry): ImageDraft {
		const spec = item.spec;
		const health = spec.healthcheck;
		const policy = resolveHealthPolicy(spec.health_policy);
		const stored = spec.health_policy ?? {};
		const storedAfter = stored.unhealthy_after_sec == null ? '' : String(stored.unhealthy_after_sec);
		const storedMax = stored.max_actions_per_hour == null ? '' : String(stored.max_actions_per_hour);
		return {
			name: item.name,
			workload: spec.kind,
			image: spec.image,
			command: spec.command && spec.command.length > 0 ? [...spec.command] : [''],
			entrypoint: spec.entrypoint && spec.entrypoint.length > 0 ? [...spec.entrypoint] : [''],
			ports: spec.ports.map((port) => ({ host: String(port.host), container: String(port.container), public: port.public })),
			env: Object.entries(spec.env).map(([key, value]) => ({ key, value })),
			envSets: [...spec.env_sets],
			secrets: Object.entries(spec.secret_env).map(([key, reference]) => {
				const dot = reference.indexOf('.');
				return { key, set: reference.slice(0, dot), name: reference.slice(dot + 1) };
			}),
			volumes: spec.volumes.map((volume) => ({ name: volume.name, target: volume.target, readOnly: volume.read_only })),
			files: spec.files.map((file) => ({ file: file.file, target: file.target })),
			restart: spec.kind === 'job' ? 'no' : spec.restart,
			user: spec.user,
			healthyAfter: spec.kind === 'service' ? String(spec.healthy_after_sec) : '',
			timeoutSec: spec.kind === 'job' ? String(spec.timeout_sec) : '',
			memoryMb: spec.memory_mb == null ? '' : String(spec.memory_mb),
			healthTest: health ? health.test.join('\n') : '',
			healthInterval: health ? String(health.interval_sec) : '',
			healthTimeout: health ? String(health.timeout_sec) : '',
			healthRetries: health ? String(health.retries) : '',
			healthStart: health ? String(health.start_period_sec) : '',
			logMaxSizeMb: spec.logging ? String(spec.logging.max_size_mb) : '',
			logMaxFiles: spec.logging ? String(spec.logging.max_files) : '',
			healthOnDeployFailure: policy.on_deploy_failure,
			healthOnUnhealthy: policy.on_unhealthy,
			healthUnhealthyAfter: storedAfter,
			healthMaxActions: storedMax,
			healthKeepKeys: storedHealthKeys(spec.health_policy),
			healthStored: { unhealthyAfter: storedAfter, maxActions: storedMax }
		};
	}

	const DEPLOY_FAILURE_LABELS = { rollback: 'Roll back', stop: 'Stop', keep: 'Keep running' } as const;
	const UNHEALTHY_LABELS = { none: 'Do nothing', restart: 'Restart', rollback: 'Roll back' } as const;

	let draft = $state<ImageDraft>(untrack(() => (editor ? editor.draft : entry ? fromEntry(entry) : blankImageDraft())));
	let clientMessage = $state<string | null>(null);
	let clientField = $state<string | null>(null);
	let paste = $state('');
	let pasteNote = $state<string | null>(null);
	let unsupported = $state<string[]>([]);
	let seenMessage = $state<string | null>(untrack(() => editor?.message ?? null));
	let focusedError = $state<string | null>(null);

	function focusError() {
		if (!browser) return;
		document.getElementById(`${fieldId}-error`)?.focus();
	}

	const fieldId = $derived(mode === 'edit' && entry ? `catalog-image-${entry.name}` : 'catalog-image-new');
	const message = $derived(clientMessage ?? editor?.message ?? null);
	const field = $derived(clientField ?? editor?.field ?? null);
	const setOptions = $derived.by(() => {
		const names = new Set(sets.map((set) => set.name));
		for (const name of draft.envSets) names.add(name);
		return [...names].sort();
	});
	const fileOptions = $derived.by(() => {
		const names = new Set(files.map((file) => file.name));
		for (const row of draft.files) {
			if (row.file !== '') names.add(row.file);
		}
		return [...names].sort();
	});
	const previewLine = $derived.by(() => {
		const setKeys = draft.envSets.flatMap((name) => sets.find((set) => set.name === name)?.keys ?? []);
		const memory = /^[0-9]+$/.test(draft.memoryMb.trim()) ? Number(draft.memoryMb.trim()) : null;
		return dockerRunPreview({
			name: mode === 'edit' && entry ? entry.name : draft.name,
			image: draft.image,
			command: draft.command.map((item) => item.trim()).filter((item) => item !== ''),
			entrypoint: draft.entrypoint.map((item) => item.trim()).filter((item) => item !== ''),
			ports: draft.ports.flatMap((port) => {
				if (!/^[0-9]+$/.test(port.host) || !/^[0-9]+$/.test(port.container)) return [];
				return [{ host: Number(port.host), container: Number(port.container), public: port.public }];
			}),
			envKeys: [...draft.env.map((row) => row.key.trim()), ...draft.secrets.map((row) => row.key.trim()), ...setKeys],
			volumes: draft.volumes
				.filter((volume) => volume.name.trim() !== '' && volume.target.trim() !== '')
				.map((volume) => ({ name: volume.name.trim(), target: volume.target.trim(), readOnly: volume.readOnly })),
			files: draft.files
				.filter((file) => file.file.trim() !== '' && file.target.trim() !== '')
				.map((file) => ({ file: file.file.trim(), target: file.target.trim() })),
			restart: draft.workload === 'job' ? 'no' : draft.restart,
			user: draft.user.trim(),
			memoryMb: memory,
			logging: loggingForPreview(draft.logMaxSizeMb, draft.logMaxFiles)
		});
	});

	$effect(() => {
		const next = editor?.message ?? null;
		if (next === untrack(() => seenMessage) || !editor) return;
		seenMessage = next;
		draft = editor.draft;
	});

	$effect(() => {
		if (!browser || !message) return;
		const token = `${field ?? ''}\0${message}`;
		if (token === untrack(() => focusedError)) return;
		focusedError = token;
		void tick().then(() => focusError());
	});

	function keysFor(setName: string, current: string): string[] {
		const keys = sets.find((set) => set.name === setName)?.keys ?? [];
		if (current !== '' && !keys.includes(current)) return [current, ...keys];
		return [...keys];
	}

	function optionsFor(current: string): string[] {
		const names = new Set(files.map((file) => file.name));
		if (current !== '' && !names.has(current)) names.add(current);
		return [...names].sort();
	}

	function toggleSet(name: string, checked: boolean) {
		if (checked) {
			if (!draft.envSets.includes(name)) draft.envSets = [...draft.envSets, name];
			return;
		}
		draft.envSets = draft.envSets.filter((item) => item !== name);
	}

	function applyPaste() {
		const parsed = parseDockerRun(paste, draft.workload);
		if (!parsed.ok) {
			pasteNote = parsed.message;
			unsupported = [];
			return;
		}
		paste = '';
		pasteNote = null;
		unsupported = parsed.unsupported;
		draft = applyDockerPaste(draft, parsed);
	}

	// Registry tags (api-v1 v1.16). The rules live in ImageTagLookup; the form re-reads it on each change.
	let imageFocused = $state(false);
	let tagListOpen = $state(false);
	let tagVersion = $state(0);
	let tagsPost = $state<ImageLookupPost | null>(null);
	let digestPost = $state<ImageLookupPost | null>(null);
	const lookup = new ImageTagLookup({
		schedule: (run, ms) => setTimeout(run, ms),
		cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		requestTags: (repo) => tagsPost?.send(repo),
		requestDigest: (ref) => digestPost?.send(ref),
		onChange: () => (tagVersion += 1)
	});

	const imageRepo = $derived(imageRepository(draft.image));
	const tagLookup = $derived.by(() => {
		void tagVersion;
		return lookup.lookup(draft.image);
	});
	const pinLine = $derived.by(() => {
		void tagVersion;
		return lookup.pinLine(draft.image);
	});
	const tagOptions = $derived(tagLookup?.state === 'ready' ? filterTags(tagLookup.tags, tagQuery(draft.image)) : { shown: [], more: 0 });
	const tagsMessage = $derived(tagLookupMessage(tagLookup));
	const tagStatus = $derived(tagAnnouncement(tagLookup, pinLine, tagOptions.more > 0 ? tagOptions.shown.length : undefined));
	const hasTagList = $derived(tagOptions.shown.length > 0);
	const settingsHref = $derived(`${page.url.pathname}?tab=settings#registries`);

	$effect(() => {
		if (!browser || !tagsAction) return;
		lookup.update(draft.image, imageFocused);
	});

	$effect(() => () => lookup.dispose());

	function pickTag(tag: string) {
		const next = lookup.pick(draft.image, tag);
		if (next == null) return;
		draft.image = next;
		tagListOpen = false;
	}

	function takeDigest(requested: string, data: Record<string, unknown>) {
		const next = lookup.takeDigest(draft.image, requested, (data.catalogImageDigest as ImageDigestResult | undefined) ?? null);
		if (next != null) draft.image = next;
	}

	function invalid(name: string): boolean {
		return field === name;
	}

	function describedBy(name: string): string | undefined {
		if (message && field === name) return `${fieldId}-error`;
		return undefined;
	}

	/** The unhealthy select is described by its hint (when an action is chosen) and then its error. */
	function unhealthyDescribedBy(): string | undefined {
		const ids = [draft.healthOnUnhealthy !== 'none' ? `${fieldId}-unhealthy-hint` : null, describedBy('health_policy.on_unhealthy') ?? null].filter((id) => id != null);
		return ids.length > 0 ? ids.join(' ') : undefined;
	}
</script>

<form
	method="POST"
	action={saveAction}
	class="grid gap-3"
	use:enhance={({ cancel }) => {
		const known = sets.length > 0 ? sets : undefined;
		const knownFiles = filesStatus === 'ready' ? files.map((file) => file.name) : undefined;
		const check = imageSpecFromDraft(draft, known, mode === 'create', knownFiles);
		if (!check.ok) {
			clientField = check.field;
			clientMessage = check.message;
			cancel();
			void tick().then(() => focusError());
			return;
		}
		clientField = null;
		clientMessage = null;
		return async ({ result, update }) => {
			// Close and announce before applyAction. A redirect may not return, and the dialog must not stay open.
			await settleImageForm(result, mode, entry, draft, onSettled, update);
		};
	}}
>
	<Input type="hidden" name="entry_kind" value="image" />
	<Input type="hidden" name="editor_mode" value={mode === 'edit' ? 'edit' : 'create'} />
	<Input type="hidden" name="workload" value={draft.workload} />
	{#if mode === 'edit' && entry}
		<Input type="hidden" name="entry_name" value={entry.name} />
		<p class="text-sm font-medium">{entry.name}</p>
	{:else}
		<Label class="grid gap-1.5" for="{fieldId}-name">
			Name
			<Input id="{fieldId}-name" name="name" bind:value={draft.name} required maxlength={48} autocomplete="off" aria-invalid={invalid('name')} aria-describedby={describedBy('name')} />
		</Label>
	{/if}
	{#snippet fieldNotice(name: string)}
		{#if message && field === name}
			<div id="{fieldId}-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
				<Notice kind="error">{message}</Notice>
			</div>
		{/if}
	{/snippet}
	{@render fieldNotice('name')}
	<div class="flex flex-wrap gap-2" role="group" aria-label="Workload">
		<Button type="button" variant={draft.workload === 'service' ? 'default' : 'outline'} aria-pressed={draft.workload === 'service'} onclick={() => (draft.workload = 'service')}>Service</Button>
		<Button type="button" variant={draft.workload === 'job' ? 'default' : 'outline'} aria-pressed={draft.workload === 'job'} onclick={() => (draft.workload = 'job')}>Job</Button>
	</div>
	<Label class="grid gap-1.5" for="{fieldId}-image">
		Image
		<Combobox.Root bind:open={() => tagListOpen && hasTagList, (next) => (tagListOpen = next)} onPick={pickTag}>
			<Combobox.Input
				id="{fieldId}-image"
				name="image"
				bind:value={draft.image}
				required
				maxlength={255}
				autocomplete="off"
				spellcheck="false"
				aria-invalid={invalid('image')}
				aria-describedby={imageDescribedBy(fieldId, { error: describedBy('image') != null, tags: tagsMessage != null, pin: pinLine != null })}
				onfocus={() => {
					imageFocused = true;
					tagListOpen = true;
				}}
				onblur={() => (imageFocused = false)}
			/>
			{#if hasTagList}
				<Combobox.Content aria-label="Image tags" footer={tagOptions.more > 0 ? moreFooter : undefined}>
					{#each tagOptions.shown as tag (tag)}
						<Combobox.Item value={tag} label={imageRepo == null ? tag : taggedRef(imageRepo, tag)}>{tag}</Combobox.Item>
					{/each}
				</Combobox.Content>
			{/if}
		</Combobox.Root>
	</Label>
	{#snippet moreFooter()}
		{moreLabel(tagOptions.more)}
	{/snippet}
	{#if tagLookup?.state === 'loading'}
		<!-- The live region below announces this; the line is for sighted users. -->
		<p class="text-muted-foreground text-sm" aria-hidden="true">{TAGS_LOADING}</p>
	{/if}
	<div class="sr-only" role="status" aria-live="polite">{tagStatus}</div>
	<ImageTagNotes {fieldId} message={tagsMessage} authFailed={tagLookup?.state === 'auth_failed'} {settingsHref} {pinLine} />
	{@render fieldNotice('image')}
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Paste a docker run</p>
		<Textarea bind:value={paste} rows={3} spellcheck="false" aria-label="Paste a docker run command" />
		<div>
			<Button type="button" variant="outline" onclick={applyPaste}>Apply paste</Button>
		</div>
		{#if pasteNote}
			<div class="max-w-full min-w-0 break-words">
				<Notice kind="error">{pasteNote}</Notice>
			</div>
		{/if}
		{#if unsupported.length > 0}
			<p class="text-muted-foreground text-sm">Not applied: {unsupported.join(', ')}</p>
		{/if}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Command</p>
		{#each draft.command as row, index (index)}
			<div class="flex items-center gap-2">
				<Label class="sr-only" for="{fieldId}-command-{index}">Command argument {index + 1}</Label>
				<Input id="{fieldId}-command-{index}" name="command" bind:value={draft.command[index]} maxlength={4096} spellcheck="false" aria-invalid={invalid('command')} aria-describedby={describedBy('command')} />
				<Button type="button" variant="outline" aria-label="Remove command argument {index + 1}" onclick={() => (draft.command = draft.command.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.command.length >= 32} onclick={() => (draft.command = [...draft.command, ''])}>Add argument</Button>
		{@render fieldNotice('command')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Entrypoint</p>
		{#each draft.entrypoint as row, index (index)}
			<div class="flex items-center gap-2">
				<Label class="sr-only" for="{fieldId}-entry-{index}">Entrypoint argument {index + 1}</Label>
				<Input id="{fieldId}-entry-{index}" name="entrypoint" bind:value={draft.entrypoint[index]} maxlength={4096} spellcheck="false" aria-invalid={invalid('entrypoint')} aria-describedby={describedBy('entrypoint')} />
				<Button type="button" variant="outline" aria-label="Remove entrypoint argument {index + 1}" onclick={() => (draft.entrypoint = draft.entrypoint.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.entrypoint.length >= 32} onclick={() => (draft.entrypoint = [...draft.entrypoint, ''])}>Add argument</Button>
		{@render fieldNotice('entrypoint')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Ports</p>
		<p class="text-muted-foreground text-sm">Public ports listen on all of the host's interfaces and are only allowed when the host's runner.toml sets allow_public_ports = true. Otherwise the deploy is refused.</p>
		{#each draft.ports as row, index (index)}
			<div class="flex flex-wrap items-center gap-2">
				<Input type="hidden" name="port_public" value={row.public ? '1' : '0'} />
				<Label class="sr-only" for="{fieldId}-port-host-{index}">Host port {index + 1}</Label>
				<Input id="{fieldId}-port-host-{index}" name="port_host" bind:value={draft.ports[index].host} inputmode="numeric" maxlength={5} placeholder="Host" aria-invalid={invalid('ports')} aria-describedby={describedBy('ports')} />
				<Label class="sr-only" for="{fieldId}-port-container-{index}">Container port {index + 1}</Label>
				<Input id="{fieldId}-port-container-{index}" name="port_container" bind:value={draft.ports[index].container} inputmode="numeric" maxlength={5} placeholder="Container" aria-invalid={invalid('ports')} aria-describedby={describedBy('ports')} />
				<Label class="flex items-center gap-2" for="{fieldId}-port-public-{index}">
					<Checkbox id="{fieldId}-port-public-{index}" checked={row.public} aria-label="Public (all interfaces) port {index + 1}" onCheckedChange={(value) => setPortPublic(draft.ports[index], value)} />
					Public (all interfaces)
				</Label>
				<Button type="button" variant="outline" aria-label="Remove port {index + 1}" onclick={() => (draft.ports = draft.ports.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.ports.length >= 16} onclick={() => (draft.ports = [...draft.ports, { host: '', container: '', public: false }])}>Add port</Button>
		{@render fieldNotice('ports')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Environment</p>
		{#each draft.env as row, index (index)}
			<div class="flex flex-wrap items-center gap-2">
				<Label class="sr-only" for="{fieldId}-env-key-{index}">Environment key {index + 1}</Label>
				<Input id="{fieldId}-env-key-{index}" name="env_key" bind:value={draft.env[index].key} maxlength={64} placeholder="KEY" spellcheck="false" aria-invalid={invalid('env')} aria-describedby={describedBy('env')} />
				<Label class="sr-only" for="{fieldId}-env-value-{index}">Environment value {index + 1}</Label>
				<Input id="{fieldId}-env-value-{index}" name="env_value" bind:value={draft.env[index].value} maxlength={4096} placeholder="Value" spellcheck="false" aria-invalid={invalid('env')} aria-describedby={describedBy('env')} />
				<Button type="button" variant="outline" aria-label="Remove env var {index + 1}" onclick={() => (draft.env = draft.env.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.env.length >= 64} onclick={() => (draft.env = [...draft.env, { key: '', value: '' }])}>Add variable</Button>
		{@render fieldNotice('env')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Env sets</p>
		{#if setsStatus === 'loading'}
			<p class="text-muted-foreground text-sm">Loading env sets…</p>
		{:else if setsStatus === 'error'}
			<Notice kind="error">{setsMessage ?? 'Env sets could not be loaded.'}</Notice>
			{#if retrySets}
				<Button type="button" variant="outline" onclick={retrySets}>Retry</Button>
			{/if}
		{:else if setOptions.length === 0}
			<p class="text-muted-foreground text-sm">No env sets yet.</p>
		{:else}
			{#each setOptions as name (name)}
				<Label class="flex min-w-0 items-start gap-2">
					<Checkbox name="env_set" value={name} checked={draft.envSets.includes(name)} onCheckedChange={(value) => toggleSet(name, value === true)} />
					<span class="min-w-0 break-all">{name}</span>
				</Label>
			{/each}
		{/if}
		{@render fieldNotice('env_sets')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Secret env</p>
		{#each draft.secrets as row, index (index)}
			<div class="grid gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<Label class="sr-only" for="{fieldId}-secret-key-{index}">Secret key {index + 1}</Label>
					<Input id="{fieldId}-secret-key-{index}" name="secret_key" bind:value={draft.secrets[index].key} maxlength={64} placeholder="KEY" spellcheck="false" aria-invalid={invalid('secret_env')} aria-describedby={describedBy('secret_env')} />
					<Button type="button" variant="outline" aria-label="Remove secret {index + 1}" onclick={() => (draft.secrets = draft.secrets.filter((_, item) => item !== index))}>Remove</Button>
				</div>
				<Input type="hidden" name="secret_set" value={row.set} />
				<div role="radiogroup" aria-label="Secret set {index + 1}" class="grid min-w-0 gap-1">
					{#each setOptions as name (name)}
						<Button
							type="button"
							role="radio"
							variant={row.set === name ? 'secondary' : 'outline'}
							aria-checked={row.set === name}
							class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
							onclick={() => (draft.secrets[index].set = name)}>{name}</Button>
					{/each}
				</div>
				<Input type="hidden" name="secret_name" value={row.name} />
				<div role="radiogroup" aria-label="Secret name {index + 1}" class="grid min-w-0 gap-1">
					{#each keysFor(row.set, row.name) as key (key)}
						<Button
							type="button"
							role="radio"
							variant={row.name === key ? 'secondary' : 'outline'}
							aria-checked={row.name === key}
							class="h-auto w-full min-w-0 justify-start text-left whitespace-normal break-all"
							onclick={() => (draft.secrets[index].name = key)}>{key}</Button>
					{/each}
				</div>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.secrets.length >= 64} onclick={() => (draft.secrets = [...draft.secrets, { key: '', set: '', name: '' }])}>Add secret</Button>
		{@render fieldNotice('secret_env')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Volumes</p>
		{#each draft.volumes as row, index (index)}
			<div class="flex flex-wrap items-center gap-2">
				<Input type="hidden" name="volume_ro" value={row.readOnly ? '1' : '0'} />
				<Label class="sr-only" for="{fieldId}-volume-name-{index}">Volume name {index + 1}</Label>
				<Input id="{fieldId}-volume-name-{index}" name="volume_name" bind:value={draft.volumes[index].name} maxlength={48} placeholder="Name" spellcheck="false" aria-invalid={invalid('volumes')} aria-describedby={describedBy('volumes')} />
				<Label class="sr-only" for="{fieldId}-volume-target-{index}">Volume target {index + 1}</Label>
				<Input id="{fieldId}-volume-target-{index}" name="volume_target" bind:value={draft.volumes[index].target} maxlength={255} placeholder="/target" spellcheck="false" aria-invalid={invalid('volumes')} aria-describedby={describedBy('volumes')} />
				<Label class="flex items-center gap-2">
					<Checkbox checked={row.readOnly} aria-label="Read only volume {index + 1}" onCheckedChange={(value) => (draft.volumes[index].readOnly = value === true)} />
					Read only
				</Label>
				<Button type="button" variant="outline" aria-label="Remove volume {index + 1}" onclick={() => (draft.volumes = draft.volumes.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.volumes.length >= 8} onclick={() => (draft.volumes = [...draft.volumes, { name: '', target: '', readOnly: false }])}>Add volume</Button>
		{@render fieldNotice('volumes')}
	</div>
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">Files</p>
		{#if filesStatus === 'loading'}
			<p class="text-muted-foreground text-sm">Loading files…</p>
		{:else if filesStatus === 'error'}
			<Notice kind="error">{filesMessage ?? 'Files could not be loaded.'}</Notice>
			{#if retryFiles}
				<Button type="button" variant="outline" onclick={retryFiles}>Retry</Button>
			{/if}
		{:else if fileOptions.length === 0 && draft.files.length === 0}
			<p class="text-muted-foreground text-sm">No files yet.</p>
		{/if}
		{#each draft.files as row, index (index)}
			<div class="flex flex-wrap items-center gap-2">
				<Input type="hidden" name="file_name" value={row.file} />
				<Label class="sr-only" for="{fieldId}-file-{index}">File {index + 1}</Label>
				<Select.Root type="single" bind:value={draft.files[index].file}>
					<Select.Trigger id="{fieldId}-file-{index}" class="w-full min-w-0" aria-invalid={invalid('files') ? true : undefined} aria-describedby={describedBy('files')}>
						<Select.Value placeholder="Choose a file">{row.file === '' ? 'Choose a file' : row.file}</Select.Value>
					</Select.Trigger>
					<Select.Content class="max-w-[calc(100vw-2rem)]">
						{#each optionsFor(row.file) as name (name)}
							<Select.Item
								value={name}
								label={name}
								class="h-auto max-w-full min-w-0 whitespace-normal [&>span:last-of-type]:min-w-0 [&>span:last-of-type]:shrink [&>span:last-of-type]:whitespace-normal [&>span:last-of-type]:break-all"
							>
								<span class="min-w-0 break-all whitespace-normal">{name}</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Label class="sr-only" for="{fieldId}-file-target-{index}">File target {index + 1}</Label>
				<Input id="{fieldId}-file-target-{index}" name="file_target" bind:value={draft.files[index].target} maxlength={255} placeholder="/target" spellcheck="false" aria-invalid={invalid('files')} aria-describedby={describedBy('files')} />
				<Button type="button" variant="outline" aria-label="Remove file {index + 1}" onclick={() => (draft.files = draft.files.filter((_, item) => item !== index))}>Remove</Button>
			</div>
		{/each}
		<Button type="button" variant="outline" disabled={draft.files.length >= 16} onclick={() => (draft.files = [...draft.files, { file: '', target: '' }])}>Add file</Button>
		{@render fieldNotice('files')}
	</div>
	{#if draft.workload === 'service'}
		<Label class="grid gap-1.5" for="{fieldId}-restart">
			Restart
			<Select.Root type="single" name="restart" bind:value={draft.restart}>
				<Select.Trigger id="{fieldId}-restart" class="w-full min-w-0" aria-invalid={invalid('restart') ? true : undefined} aria-describedby={describedBy('restart')}>
					<Select.Value>{draft.restart}</Select.Value>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="unless-stopped" label="unless-stopped">unless-stopped</Select.Item>
					<Select.Item value="on-failure" label="on-failure">on-failure</Select.Item>
					<Select.Item value="no" label="no">no</Select.Item>
				</Select.Content>
			</Select.Root>
		</Label>
		{@render fieldNotice('restart')}
		<Label class="grid gap-1.5" for="{fieldId}-healthy">
			Healthy after seconds
			<Input id="{fieldId}-healthy" name="healthy_after_sec" bind:value={draft.healthyAfter} inputmode="numeric" maxlength={3} placeholder="30" aria-invalid={invalid('healthy_after_sec')} aria-describedby={describedBy('healthy_after_sec')} />
		</Label>
		{@render fieldNotice('healthy_after_sec')}
		<div class="grid gap-3" role="group" aria-label="Health check (Docker)">
			<p class="text-sm font-medium">Health check (Docker)</p>
			<p class="text-muted-foreground text-sm">One argument per line. Leave the command empty to use the image default.</p>
			<Label class="grid gap-1.5" for="{fieldId}-health-test">
				Command
				<Textarea
					id="{fieldId}-health-test"
					name="health_test"
					bind:value={draft.healthTest}
					rows={4}
					spellcheck="false"
					autocomplete="off"
					aria-invalid={invalid('healthcheck') ? true : undefined}
					aria-describedby={describedBy('healthcheck')}
				/>
			</Label>
			{@render fieldNotice('healthcheck')}
			<Label class="grid gap-1.5" for="{fieldId}-health-interval">
				Interval seconds
				<Input
					id="{fieldId}-health-interval"
					name="health_interval"
					type="number"
					min={5}
					max={300}
					bind:value={
						() => (draft.healthInterval === '' ? null : Number(draft.healthInterval)),
						(next) => (draft.healthInterval = next == null || Number.isNaN(next) ? '' : String(next))
					}
					placeholder="30"
					aria-invalid={invalid('healthcheck.interval_sec')}
					aria-describedby={describedBy('healthcheck.interval_sec')}
				/>
			</Label>
			{@render fieldNotice('healthcheck.interval_sec')}
			<Label class="grid gap-1.5" for="{fieldId}-health-timeout">
				Timeout seconds
				<Input
					id="{fieldId}-health-timeout"
					name="health_timeout"
					type="number"
					min={1}
					max={60}
					bind:value={
						() => (draft.healthTimeout === '' ? null : Number(draft.healthTimeout)),
						(next) => (draft.healthTimeout = next == null || Number.isNaN(next) ? '' : String(next))
					}
					placeholder="5"
					aria-invalid={invalid('healthcheck.timeout_sec')}
					aria-describedby={describedBy('healthcheck.timeout_sec')}
				/>
			</Label>
			{@render fieldNotice('healthcheck.timeout_sec')}
			<Label class="grid gap-1.5" for="{fieldId}-health-retries">
				Retries
				<Input
					id="{fieldId}-health-retries"
					name="health_retries"
					type="number"
					min={1}
					max={10}
					bind:value={
						() => (draft.healthRetries === '' ? null : Number(draft.healthRetries)),
						(next) => (draft.healthRetries = next == null || Number.isNaN(next) ? '' : String(next))
					}
					placeholder="3"
					aria-invalid={invalid('healthcheck.retries')}
					aria-describedby={describedBy('healthcheck.retries')}
				/>
			</Label>
			{@render fieldNotice('healthcheck.retries')}
			<Label class="grid gap-1.5" for="{fieldId}-health-start">
				Start period seconds
				<Input
					id="{fieldId}-health-start"
					name="health_start"
					type="number"
					min={0}
					max={600}
					bind:value={
						() => (draft.healthStart === '' ? null : Number(draft.healthStart)),
						(next) => (draft.healthStart = next == null || Number.isNaN(next) ? '' : String(next))
					}
					placeholder="0"
					aria-invalid={invalid('healthcheck.start_period_sec')}
					aria-describedby={describedBy('healthcheck.start_period_sec')}
				/>
			</Label>
			{@render fieldNotice('healthcheck.start_period_sec')}
		</div>
		<div class="grid gap-3" role="group" aria-label="When health fails">
			<p class="text-sm font-medium">When health fails</p>
			<Label class="grid gap-1.5" for="{fieldId}-on-deploy-failure">
				If a deploy fails
				<Select.Root type="single" name="health_on_deploy_failure" bind:value={draft.healthOnDeployFailure}>
					<Select.Trigger
						id="{fieldId}-on-deploy-failure"
						class="w-full min-w-0"
						aria-invalid={invalid('health_policy.on_deploy_failure') ? true : undefined}
						aria-describedby={describedBy('health_policy.on_deploy_failure')}
					>
						<Select.Value>{DEPLOY_FAILURE_LABELS[draft.healthOnDeployFailure]}</Select.Value>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="rollback" label="Roll back">Roll back</Select.Item>
						<Select.Item value="stop" label="Stop">Stop</Select.Item>
						<Select.Item value="keep" label="Keep running">Keep running</Select.Item>
					</Select.Content>
				</Select.Root>
			</Label>
			{@render fieldNotice('health_policy.on_deploy_failure')}
			<Label class="grid gap-1.5" for="{fieldId}-on-unhealthy">
				If it turns unhealthy later
				<Select.Root type="single" name="health_on_unhealthy" bind:value={draft.healthOnUnhealthy}>
					<Select.Trigger
						id="{fieldId}-on-unhealthy"
						class="w-full min-w-0"
						aria-invalid={invalid('health_policy.on_unhealthy') ? true : undefined}
						aria-describedby={unhealthyDescribedBy()}
					>
						<Select.Value>{UNHEALTHY_LABELS[draft.healthOnUnhealthy]}</Select.Value>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="none" label="Do nothing">Do nothing</Select.Item>
						<Select.Item value="restart" label="Restart">Restart</Select.Item>
						<Select.Item value="rollback" label="Roll back">Roll back</Select.Item>
					</Select.Content>
				</Select.Root>
			</Label>
			{#if draft.healthOnUnhealthy !== 'none'}
				<p id="{fieldId}-unhealthy-hint" class="text-muted-foreground text-sm">Needs the Docker health check command above.</p>
			{/if}
			{@render fieldNotice('health_policy.on_unhealthy')}
			{#each draft.healthKeepKeys as key (key)}
				<Input type="hidden" name="health_keep_key" value={key} />
			{/each}
			<!-- Posted with any action so a refused save keeps them; read only under Do nothing. -->
			{#if draft.healthKeepKeys.includes('unhealthy_after_sec')}
				<Input type="hidden" name="health_stored_unhealthy_after_sec" value={draft.healthStored.unhealthyAfter} />
			{/if}
			{#if draft.healthKeepKeys.includes('max_actions_per_hour')}
				<Input type="hidden" name="health_stored_max_actions_per_hour" value={draft.healthStored.maxActions} />
			{/if}
			{#if draft.healthOnUnhealthy !== 'none'}
				<Label class="grid gap-1.5" for="{fieldId}-unhealthy-after">
					Unhealthy for (seconds)
					<Input
						id="{fieldId}-unhealthy-after"
						name="health_unhealthy_after_sec"
						type="number"
						min={15}
						max={600}
						bind:value={
							() => (draft.healthUnhealthyAfter === '' ? null : Number(draft.healthUnhealthyAfter)),
							(next) => (draft.healthUnhealthyAfter = next == null || Number.isNaN(next) ? '' : String(next))
						}
						placeholder={String(HEALTH_POLICY_DEFAULTS.unhealthy_after_sec)}
						aria-invalid={invalid('health_policy.unhealthy_after_sec')}
						aria-describedby={describedBy('health_policy.unhealthy_after_sec')}
					/>
				</Label>
				{@render fieldNotice('health_policy.unhealthy_after_sec')}
				<Label class="grid gap-1.5" for="{fieldId}-max-actions">
					Max actions per hour
					<Input
						id="{fieldId}-max-actions"
						name="health_max_actions_per_hour"
						type="number"
						min={1}
						max={10}
						bind:value={
							() => (draft.healthMaxActions === '' ? null : Number(draft.healthMaxActions)),
							(next) => (draft.healthMaxActions = next == null || Number.isNaN(next) ? '' : String(next))
						}
						placeholder={String(HEALTH_POLICY_DEFAULTS.max_actions_per_hour)}
						aria-invalid={invalid('health_policy.max_actions_per_hour')}
						aria-describedby={describedBy('health_policy.max_actions_per_hour')}
					/>
				</Label>
				{@render fieldNotice('health_policy.max_actions_per_hour')}
			{/if}
		</div>
	{:else}
		<Input type="hidden" name="restart" value="no" />
		<Label class="grid gap-1.5" for="{fieldId}-timeout">
			Timeout seconds
			<Input id="{fieldId}-timeout" name="timeout_sec" bind:value={draft.timeoutSec} inputmode="numeric" maxlength={4} placeholder="600" aria-invalid={invalid('timeout_sec')} aria-describedby={describedBy('timeout_sec')} />
		</Label>
		{@render fieldNotice('timeout_sec')}
	{/if}
	<div class="grid gap-3" role="group" aria-label="Logs">
		<p class="text-sm font-medium">Logs</p>
		<p class="text-muted-foreground text-sm">Leave both empty and Deploybot uses {DEFAULT_LOG_SIZE_MB} MB and {DEFAULT_LOG_FILES} files.</p>
		<Label class="grid gap-1.5" for="{fieldId}-log-size">
			Max size per file (MB)
			<Input
				id="{fieldId}-log-size"
				name="log_max_size_mb"
				type="number"
				min={1}
				max={100}
				bind:value={
					() => (draft.logMaxSizeMb === '' ? null : Number(draft.logMaxSizeMb)),
					(next) => (draft.logMaxSizeMb = next == null || Number.isNaN(next) ? '' : String(next))
				}
				placeholder={String(DEFAULT_LOG_SIZE_MB)}
				aria-invalid={invalid('logging.max_size_mb')}
				aria-describedby={describedBy('logging.max_size_mb')}
			/>
		</Label>
		{@render fieldNotice('logging.max_size_mb')}
		<Label class="grid gap-1.5" for="{fieldId}-log-files">
			Files kept
			<Input
				id="{fieldId}-log-files"
				name="log_max_files"
				type="number"
				min={1}
				max={10}
				bind:value={
					() => (draft.logMaxFiles === '' ? null : Number(draft.logMaxFiles)),
					(next) => (draft.logMaxFiles = next == null || Number.isNaN(next) ? '' : String(next))
				}
				placeholder={String(DEFAULT_LOG_FILES)}
				aria-invalid={invalid('logging.max_files')}
				aria-describedby={describedBy('logging.max_files')}
			/>
		</Label>
		{@render fieldNotice('logging.max_files')}
	</div>
	<Label class="grid gap-1.5" for="{fieldId}-user">
		User
		<Input id="{fieldId}-user" name="user" bind:value={draft.user} maxlength={64} autocomplete="off" spellcheck="false" aria-invalid={invalid('user')} aria-describedby={describedBy('user')} />
	</Label>
	{@render fieldNotice('user')}
	<Label class="grid gap-1.5" for="{fieldId}-memory">
		Memory MB
		<Input id="{fieldId}-memory" name="memory_mb" bind:value={draft.memoryMb} inputmode="numeric" maxlength={5} placeholder="Suggested {SUGGESTED_MEMORY_MB}" aria-invalid={invalid('memory_mb')} aria-describedby={describedBy('memory_mb')} />
	</Label>
	{@render fieldNotice('memory_mb')}
	<div class="grid gap-1.5">
		<p class="text-sm font-medium">docker run</p>
		<pre class="bg-muted max-h-40 overflow-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap" aria-label="docker run preview">{previewLine}</pre>
	</div>
	{#if message && field == null}
		<div id="{fieldId}-error" tabindex="-1" class="max-w-full min-w-0 break-words focus-visible:ring-3 focus-visible:ring-ring">
			<Notice kind="error">{message}</Notice>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit">{mode === 'create' ? 'Create' : 'Save'}</Button>
		{#if cancel}
			{@render cancel()}
		{/if}
	</div>
</form>
{#if tagsAction}
	<ImageLookupPost bind:this={tagsPost} action={tagsAction} onResult={(repo, data) => lookup.takeTags(repo, (data.catalogImageTags as ImageTagsResult | undefined) ?? null)} />
{/if}
{#if digestAction}
	<ImageLookupPost bind:this={digestPost} action={digestAction} onResult={takeDigest} />
{/if}
