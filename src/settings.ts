import YAML from "yaml";
import type { StatusConfig, TaskNotesModelConfig } from "./types";

/*
 * App settings records (mdbase.app-settings 1.0.0): one record per app at
 * `_settings/<app>.md` whose flat frontmatter holds behaviour every client of
 * that app honours in the collection. The generic part below follows mdbase
 * Reader's implementation; the TaskNotes part defines the tasknotes.settings
 * 1.0.0 fields, which tasknotes.task 0.3.0-rc.6 moved out of the type binding.
 *
 * - A missing record means defaults. Nothing here creates or repairs a record
 *   on read: an unusable field takes its default with a warning.
 * - A save patches only the fields it changes, guarded by the revision read.
 * - A field changed elsewhere since the edit started is a conflict.
 * - A newer settings_version makes the settings read-only.
 */

/** The folder collection-scope settings records live in. */
export const APP_SETTINGS_FOLDER = "_settings";

export interface AppSettingField<Value> {
	readonly default: Value;
	/** Why a stored value is unusable; undefined when it is usable. */
	readonly problem: (value: unknown) => string | undefined;
	/** How a usable stored value is read. Without it the value is used as written. */
	readonly read?: (value: unknown) => Value;
}

export interface AppSettingsDefinition<Values extends object> {
	/** The app id, `^[a-z0-9]+([.-][a-z0-9]+)*$`. */
	readonly app: string;
	/** The app's settings type, which the record is created as. */
	readonly type: string;
	/** The newest settings version this client understands, and the one it writes. */
	readonly settingsVersion: number;
	readonly fields: { readonly [Key in keyof Values]: AppSettingField<Values[Key]> };
}

export interface AppSettingsWarning {
	readonly field?: string;
	readonly message: string;
}

export interface ResolvedAppSettings<Values extends object> {
	/** Every setting: the record's value when it is usable, else the default. */
	readonly values: Values;
	/** The settings the record holds a usable value for. */
	readonly stored: Partial<Values>;
	readonly warnings: readonly AppSettingsWarning[];
	/** Why these settings cannot be saved from this client, when they cannot. */
	readonly readOnly?: string;
}

/** A save: a new value per changed setting, or null to go back to the default. */
export type AppSettingsChanges<Values extends object> = {
	-readonly [Key in keyof Values]?: Values[Key] | null;
};

export function appSettingsPath(app: string): string {
	return `${APP_SETTINGS_FOLDER}/${app}.md`;
}

export function defaultAppSettings<Values extends object>(
	definition: AppSettingsDefinition<Values>
): ResolvedAppSettings<Values> {
	return resolveAppSettings(definition, undefined);
}

/**
 * The settings a record's frontmatter gives, or the defaults when there is no
 * record. A record whose settings_version is newer than this client
 * understands, or that is not this app's collection-scope record, is used as
 * written but read-only.
 */
export function resolveAppSettings<Values extends object>(
	definition: AppSettingsDefinition<Values>,
	frontmatter: Readonly<Record<string, unknown>> | undefined
): ResolvedAppSettings<Values> {
	const values: Record<string, unknown> = {};
	const stored: Record<string, unknown> = {};
	const warnings: AppSettingsWarning[] = [];
	for (const [key, field] of fieldEntries(definition)) {
		values[key] = cloneValue(field.default);
		if (frontmatter === undefined || !hasOwn(frontmatter, key)) continue;
		const value = frontmatter[key];
		const problem = field.problem(value);
		if (problem) {
			warnings.push({ field: key, message: problem });
		} else {
			const read = field.read ? field.read(value) : cloneValue(value);
			values[key] = read;
			stored[key] = read;
		}
	}
	const readOnly = frontmatter ? readOnlyReason(definition, frontmatter) : undefined;
	return {
		values: values as Values,
		stored: stored as Partial<Values>,
		warnings,
		...(readOnly ? { readOnly } : {}),
	};
}

/**
 * The frontmatter patch for a save: only the settings whose stored value
 * changes, with null for a setting going back to its default (the field is
 * removed). Other fields, including ones from newer clients, are left alone.
 */
export function appSettingsPatch<Values extends object>(
	definition: AppSettingsDefinition<Values>,
	frontmatter: Readonly<Record<string, unknown>>,
	changes: AppSettingsChanges<Values>
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
		if (value === undefined || !hasOwn(definition.fields, key)) continue;
		const present = hasOwn(frontmatter, key);
		if (value === null ? present : !present || !sameValue(frontmatter[key], value)) {
			patch[key] = cloneValue(value);
		}
	}
	if (
		Object.keys(patch).length > 0 &&
		frontmatter.settings_version !== definition.settingsVersion
	) {
		patch.settings_version = definition.settingsVersion;
	}
	return patch;
}

/** The frontmatter of a new settings record holding `changes`. */
export function newAppSettingsFrontmatter<Values extends object>(
	definition: AppSettingsDefinition<Values>,
	changes: AppSettingsChanges<Values>
): Record<string, unknown> {
	const values = Object.fromEntries(
		Object.entries(changes as Record<string, unknown>)
			.filter(
				([key, value]) =>
					value !== undefined && value !== null && hasOwn(definition.fields, key)
			)
			.map(([key, value]) => [key, cloneValue(value)])
	);
	return {
		app: definition.app,
		scope: "collection",
		settings_version: definition.settingsVersion,
		...values,
	};
}

/**
 * The settings `changes` would change that also changed between `base` and
 * `current`: a save prepared against `base` would overwrite someone else's edit.
 */
export function conflictingAppSettings<Values extends object>(
	definition: AppSettingsDefinition<Values>,
	base: Readonly<Record<string, unknown>> | undefined,
	current: Readonly<Record<string, unknown>> | undefined,
	changes: AppSettingsChanges<Values>
): string[] {
	return Object.keys(changes).filter(
		(key) =>
			hasOwn(definition.fields, key) &&
			(changes as Record<string, unknown>)[key] !== undefined &&
			!sameValue(base?.[key], current?.[key])
	);
}

/**
 * Apply a frontmatter patch (null removes a field) to a settings record's
 * Markdown, keeping every other field, their order and comments, and the body.
 * Without a record, `create` gives the new record's frontmatter and `typeKey`
 * names the collection's explicit type key.
 */
export function writeAppSettingsDocument(
	markdown: string | null,
	patch: Readonly<Record<string, unknown>>,
	create?: { frontmatter: Readonly<Record<string, unknown>>; type: string; typeKey: string; body?: string }
): string {
	if (markdown === null) {
		if (!create) throw new Error("A settings record can only be created with its frontmatter.");
		const frontmatter = { [create.typeKey]: create.type, ...create.frontmatter };
		return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${create.body ?? ""}`;
	}
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
	if (!match) throw new Error("The settings record has no frontmatter.");
	const document = YAML.parseDocument(match[1]);
	if (document.errors.length > 0) {
		throw new Error(document.errors.map((error) => error.message).join("; "));
	}
	if (!isRecord(document.toJS())) throw new Error("The settings record frontmatter must be an object.");
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) document.delete(key);
		else document.set(key, document.createNode(cloneValue(value)));
	}
	const body = markdown.slice(match[0].length);
	return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

/** A settings record's frontmatter, or undefined when the Markdown has none that is an object. */
export function readAppSettingsFrontmatter(markdown: string): Record<string, unknown> | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
	if (!match) return undefined;
	const value = YAML.parse(match[1]) as unknown;
	return isRecord(value) ? value : undefined;
}

function readOnlyReason<Values extends object>(
	definition: AppSettingsDefinition<Values>,
	frontmatter: Readonly<Record<string, unknown>>
): string | undefined {
	const path = appSettingsPath(definition.app);
	if (frontmatter.app !== undefined && frontmatter.app !== definition.app) {
		return `${path} names another app, so it is left as it is.`;
	}
	if (frontmatter.scope !== undefined && frontmatter.scope !== "collection") {
		return `${path} is not a collection-wide settings record, so it is left as it is.`;
	}
	const version = frontmatter.settings_version;
	if (typeof version === "number" && version > definition.settingsVersion) {
		return "A newer version of this app saved these settings. Update it to change them here.";
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// TaskNotes settings (tasknotes.settings 1.0.0)

export const TASKNOTES_SETTINGS_APP = "dev.tasknotes";
export const TASKNOTES_SETTINGS_TYPE = "tasknotes-settings";
export const TASKNOTES_SETTINGS_CONTRACT_ID = "tasknotes.settings";
export const TASKNOTES_SETTINGS_CONTRACT_VERSION = "1.0.0";
export const APP_SETTINGS_CONTRACT_ID = "mdbase.app-settings";
export const APP_SETTINGS_CONTRACT_VERSION = "1.0.0";
export const TASKNOTES_SETTINGS_VERSION = 1;
/** Version of the generated tasknotes-settings type. */
export const TASKNOTES_SETTINGS_TYPE_VERSION = 1;
export const TASKNOTES_SETTINGS_PATH = appSettingsPath(TASKNOTES_SETTINGS_APP);
/** Default auto-archive delay, in minutes, for a status without one. */
export const TASKNOTES_DEFAULT_AUTO_ARCHIVE_DELAY = 5;

export interface TaskNotesNlpTriggerSetting {
	property_id: string;
	trigger: string;
	enabled: boolean;
}

export interface TaskNotesStatusBehavior {
	next_status?: string;
	exclude_from_cycle?: boolean;
	auto_archive?: boolean;
	auto_archive_delay_minutes?: number;
}

export interface TaskNotesAppSettingsValues {
	/** Natural-language triggers; null means the app's own defaults. */
	nlp_triggers: TaskNotesNlpTriggerSetting[] | null;
	template_enabled: boolean;
	/** "" means no template. */
	template_path: string;
	occurrence_template_enabled: boolean;
	occurrence_template_path: string;
	template_failure_mode: "error" | "warning_fallback" | null;
	template_unknown_variable_policy: "preserve" | "empty" | null;
	move_on_archive: boolean;
	/** "" means the app's default archive folder. */
	archive_folder: string;
	auto_stop_time_tracking_on_complete: boolean;
	reset_body_checkboxes_on_recurrence: boolean;
	link_write_format: "wikilink" | "markdown";
	/** Behaviour per status value. A status without an entry takes the defaults. */
	status_behavior: Record<string, TaskNotesStatusBehavior>;
}

export type TaskNotesAppSettingKey = keyof TaskNotesAppSettingsValues;
export type TaskNotesAppSettingsChanges = AppSettingsChanges<TaskNotesAppSettingsValues>;

const booleanField = (label: string): AppSettingField<boolean> => ({
	default: false,
	problem: (value) => (typeof value === "boolean" ? undefined : `${label} is not true or false, so its default is used.`),
});

const pathField = (label: string): AppSettingField<string> => ({
	default: "",
	problem: (value) => (typeof value === "string" ? undefined : `${label} is not text, so its default is used.`),
	read: (value) => (value as string).trim(),
});

function enumField<Value extends string>(
	label: string,
	allowed: readonly Value[],
	fallback: Value
): AppSettingField<Value>;
function enumField<Value extends string>(
	label: string,
	allowed: readonly Value[],
	fallback: null
): AppSettingField<Value | null>;
function enumField<Value extends string>(
	label: string,
	allowed: readonly Value[],
	fallback: Value | null
): AppSettingField<Value | null> {
	return {
		default: fallback,
		problem: (value) =>
			allowed.includes(value as Value) ? undefined : `${label} must be one of ${allowed.join(", ")}, so its default is used.`,
	};
}

function readNlpTriggers(value: unknown): TaskNotesNlpTriggerSetting[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (!isRecord(entry)) return [];
		const propertyId = nonEmptyString(entry.property_id) ?? nonEmptyString(entry.propertyId);
		const trigger = nonEmptyString(entry.trigger);
		if (!propertyId || !trigger) return [];
		return [{ property_id: propertyId, trigger, enabled: typeof entry.enabled === "boolean" ? entry.enabled : true }];
	});
}

function readStatusBehavior(value: unknown): TaskNotesStatusBehavior | undefined {
	if (!isRecord(value)) return undefined;
	const behavior: TaskNotesStatusBehavior = {};
	const next = nonEmptyString(value.next_status);
	if (next) behavior.next_status = next;
	if (typeof value.exclude_from_cycle === "boolean") behavior.exclude_from_cycle = value.exclude_from_cycle;
	if (typeof value.auto_archive === "boolean") behavior.auto_archive = value.auto_archive;
	const delay = value.auto_archive_delay_minutes;
	if (typeof delay === "number" && Number.isFinite(delay) && delay >= 0) behavior.auto_archive_delay_minutes = delay;
	return behavior;
}

function readStatusBehaviors(value: unknown): Record<string, TaskNotesStatusBehavior> {
	const result: Record<string, TaskNotesStatusBehavior> = {};
	if (!isRecord(value)) return result;
	for (const [status, entry] of Object.entries(value)) {
		const behavior = readStatusBehavior(entry);
		if (status.trim() && behavior) result[status] = behavior;
	}
	return result;
}

export const tasknotesSettingsDefinition: AppSettingsDefinition<TaskNotesAppSettingsValues> = {
	app: TASKNOTES_SETTINGS_APP,
	type: TASKNOTES_SETTINGS_TYPE,
	settingsVersion: TASKNOTES_SETTINGS_VERSION,
	fields: {
		nlp_triggers: {
			default: null,
			problem: (value) => (Array.isArray(value) ? undefined : "The natural-language triggers are not a list, so the defaults are used."),
			read: readNlpTriggers,
		},
		template_enabled: booleanField("Task templating"),
		template_path: pathField("The task template path"),
		occurrence_template_enabled: booleanField("Occurrence templating"),
		occurrence_template_path: pathField("The occurrence template path"),
		template_failure_mode: enumField("The template failure mode", ["error", "warning_fallback"] as const, null),
		template_unknown_variable_policy: enumField("The unknown template variable policy", ["preserve", "empty"] as const, null),
		move_on_archive: booleanField("Moving archived tasks"),
		archive_folder: pathField("The archive folder"),
		auto_stop_time_tracking_on_complete: booleanField("Stopping time tracking on completion"),
		reset_body_checkboxes_on_recurrence: booleanField("Resetting checkboxes on recurrence"),
		link_write_format: enumField("The link format", ["wikilink", "markdown"] as const, "wikilink"),
		status_behavior: {
			default: {},
			problem: (value) => (isRecord(value) ? undefined : "The status behaviour is not a map of statuses, so the defaults are used."),
			read: readStatusBehaviors,
		},
	},
};

export const TASKNOTES_APP_SETTING_KEYS = Object.keys(
	tasknotesSettingsDefinition.fields
) as TaskNotesAppSettingKey[];

/** The behaviour of one status, with defaults for anything unset. */
export function taskNotesStatusBehavior(
	values: Pick<TaskNotesAppSettingsValues, "status_behavior">,
	status: { value: string; isSkipped?: boolean }
): Required<Omit<TaskNotesStatusBehavior, "next_status">> & Pick<TaskNotesStatusBehavior, "next_status"> {
	const entry = values.status_behavior[status.value] ?? {};
	return {
		...(entry.next_status ? { next_status: entry.next_status } : {}),
		// A skipped status is out of the cycle unless the collection says otherwise.
		exclude_from_cycle: entry.exclude_from_cycle ?? status.isSkipped === true,
		auto_archive: entry.auto_archive ?? false,
		auto_archive_delay_minutes: entry.auto_archive_delay_minutes ?? TASKNOTES_DEFAULT_AUTO_ARCHIVE_DELAY,
	};
}

/**
 * The moved settings an earlier binding (tasknotes.task rc.3 to rc.5) still
 * carries. Only usable values are returned.
 */
export function taskNotesAppSettingsFromLegacyBinding(binding: unknown): Partial<TaskNotesAppSettingsValues> {
	if (!isRecord(binding)) return {};
	const section = (key: string): Record<string, unknown> => (isRecord(binding[key]) ? binding[key] : {});
	const nlp = section("nlp");
	const templating = section("templating");
	const archive = section("archive");
	const timeTracking = section("time_tracking");
	const recurrence = section("recurrence");
	const links = section("links");
	const status = section("status");
	const raw: Record<string, unknown> = {
		nlp_triggers: nlp.triggers,
		template_enabled: templating.enabled,
		template_path: templating.template_path,
		occurrence_template_enabled: templating.occurrence_enabled,
		occurrence_template_path: templating.occurrence_template_path,
		template_failure_mode: templating.failure_mode,
		template_unknown_variable_policy: templating.unknown_variable_policy,
		move_on_archive: archive.move_on_archive,
		archive_folder: archive.folder,
		auto_stop_time_tracking_on_complete: timeTracking.auto_stop_on_complete,
		reset_body_checkboxes_on_recurrence: recurrence.reset_body_checkboxes,
		link_write_format: links.write_format,
	};
	if (Array.isArray(status.definitions)) {
		const behaviors: Record<string, TaskNotesStatusBehavior> = {};
		for (const definition of status.definitions) {
			if (!isRecord(definition)) continue;
			const value = nonEmptyString(definition.value);
			const behavior = readStatusBehavior(definition);
			if (value && behavior && Object.keys(behavior).length > 0) behaviors[value] = behavior;
		}
		if (Object.keys(behaviors).length > 0) raw.status_behavior = behaviors;
	}
	const frontmatter = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
	return resolveAppSettings(tasknotesSettingsDefinition, frontmatter).stored;
}

/** A binding with every setting tasknotes.task rc.6 moved to the settings record removed. */
export function withoutTaskNotesAppSettings(binding: unknown): Record<string, unknown> {
	const result = isRecord(binding) ? (cloneValue(binding) as Record<string, unknown>) : {};
	delete result.nlp;
	delete result.templating;
	delete result.time_tracking;
	const strip = (key: string, fields: string[]) => {
		const section = result[key];
		if (!isRecord(section)) return;
		for (const field of fields) delete section[field];
	};
	strip("archive", ["move_on_archive", "folder"]);
	strip("recurrence", ["reset_body_checkboxes"]);
	strip("links", ["write_format"]);
	const status = result.status;
	if (isRecord(status) && Array.isArray(status.definitions)) {
		for (const definition of status.definitions) {
			if (!isRecord(definition)) continue;
			delete definition.next_status;
			delete definition.exclude_from_cycle;
			delete definition.auto_archive;
			delete definition.auto_archive_delay_minutes;
		}
	}
	return result;
}

export interface ResolvedTaskNotesAppSettings extends ResolvedAppSettings<TaskNotesAppSettingsValues> {
	/** Settings taken from an earlier binding because the record does not hold them. */
	readonly legacy: Partial<TaskNotesAppSettingsValues>;
	/** Whether there is a settings record at all. */
	readonly recorded: boolean;
}

/**
 * Resolve TaskNotes settings: the record's field, then an earlier binding's,
 * then `fallback`, then the default. Status behaviour merges per status and
 * per property in the same order, so a missing or late record never loses a
 * value an earlier binding still holds.
 */
export function resolveTaskNotesAppSettings(
	frontmatter: Readonly<Record<string, unknown>> | undefined,
	options: { legacyBinding?: unknown; fallback?: Partial<TaskNotesAppSettingsValues> } = {}
): ResolvedTaskNotesAppSettings {
	const resolved = resolveAppSettings(tasknotesSettingsDefinition, frontmatter);
	const legacy = taskNotesAppSettingsFromLegacyBinding(options.legacyBinding);
	const fallback = options.fallback ?? {};
	const values = { ...resolved.values } as Record<string, unknown>;
	const usedLegacy: Record<string, unknown> = {};
	for (const key of TASKNOTES_APP_SETTING_KEYS) {
		if (key === "status_behavior") continue;
		if (hasOwn(resolved.stored, key)) continue;
		if (hasOwn(legacy, key)) {
			values[key] = cloneValue(legacy[key]);
			usedLegacy[key] = cloneValue(legacy[key]);
		} else if (fallback[key] !== undefined) {
			values[key] = cloneValue(fallback[key]);
		}
	}
	const behaviors: Record<string, TaskNotesStatusBehavior> = {};
	for (const source of [fallback.status_behavior, legacy.status_behavior, resolved.stored.status_behavior]) {
		for (const [status, behavior] of Object.entries(source ?? {})) {
			behaviors[status] = { ...behaviors[status], ...cloneValue(behavior) as TaskNotesStatusBehavior };
		}
	}
	values.status_behavior = behaviors;
	if (legacy.status_behavior) usedLegacy.status_behavior = cloneValue(legacy.status_behavior);
	return {
		...resolved,
		values: values as unknown as TaskNotesAppSettingsValues,
		legacy: usedLegacy as Partial<TaskNotesAppSettingsValues>,
		recorded: frontmatter !== undefined,
	};
}

/** The fields whose value differs between two complete sets of settings. */
export function changedTaskNotesAppSettings(
	before: Readonly<TaskNotesAppSettingsValues>,
	after: Readonly<TaskNotesAppSettingsValues>
): TaskNotesAppSettingsChanges {
	const changes: Record<string, unknown> = {};
	for (const key of TASKNOTES_APP_SETTING_KEYS) {
		if (!sameValue(before[key], after[key])) changes[key] = cloneValue(after[key]);
	}
	return changes as TaskNotesAppSettingsChanges;
}

/** Every setting as an explicit change, for writing a complete record. */
export function completeTaskNotesAppSettingsChanges(
	values: Readonly<TaskNotesAppSettingsValues>
): TaskNotesAppSettingsChanges {
	return Object.fromEntries(
		TASKNOTES_APP_SETTING_KEYS.map((key) => [key, cloneValue(values[key])])
	) as TaskNotesAppSettingsChanges;
}

/** The frontmatter patch for saving `changes` to a TaskNotes settings record. */
export function buildTaskNotesSettingsPatch(
	frontmatter: Readonly<Record<string, unknown>>,
	changes: TaskNotesAppSettingsChanges
): Record<string, unknown> {
	return appSettingsPatch(tasknotesSettingsDefinition, frontmatter, changes);
}

/** The frontmatter of a new TaskNotes settings record holding `changes`. */
export function newTaskNotesSettingsFrontmatter(changes: TaskNotesAppSettingsChanges): Record<string, unknown> {
	return newAppSettingsFrontmatter(tasknotesSettingsDefinition, changes);
}

/** The settings `changes` would change that someone else changed since `base`. */
export function conflictingTaskNotesSettings(
	base: Readonly<Record<string, unknown>> | undefined,
	current: Readonly<Record<string, unknown>> | undefined,
	changes: TaskNotesAppSettingsChanges
): string[] {
	return conflictingAppSettings(tasknotesSettingsDefinition, base, current, changes);
}

/**
 * The patch that adds `values` to an existing record without changing any
 * field it already holds: what a migration writes when another device created
 * the record first. Status behaviour adds only statuses the record lacks.
 */
export function absentTaskNotesSettingsPatch(
	frontmatter: Readonly<Record<string, unknown>>,
	values: Partial<TaskNotesAppSettingsValues>
): Record<string, unknown> {
	const changes: Record<string, unknown> = {};
	for (const key of TASKNOTES_APP_SETTING_KEYS) {
		const value = values[key];
		if (value === undefined || value === null) continue;
		if (key === "status_behavior") {
			const current = frontmatter.status_behavior;
			if (current !== undefined && !isRecord(current)) continue;
			const merged = { ...(cloneValue(value) as Record<string, unknown>), ...(cloneValue(current ?? {}) as Record<string, unknown>) };
			if (Object.keys(merged).length > 0) changes[key] = merged;
			continue;
		}
		if (!hasOwn(frontmatter, key)) changes[key] = cloneValue(value);
	}
	return appSettingsPatch(tasknotesSettingsDefinition, frontmatter, changes as TaskNotesAppSettingsChanges);
}

/** Settings the plugin and app keep outside the model configuration. */
export interface TaskNotesAppSettingsExtras {
	templating?: {
		enabled?: boolean;
		templatePath?: string;
		occurrenceEnabled?: boolean;
		occurrenceTemplatePath?: string;
	};
	archive?: { moveOnArchive?: boolean; folder?: string };
	links?: { writeFormat?: "wikilink" | "markdown" };
}

/** The settings record values a model configuration and its extras describe. */
export function taskNotesAppSettingsFromModelConfig(
	config: Pick<TaskNotesModelConfig, "statuses" | "recurrence" | "timeTracking" | "nlp">,
	extras: TaskNotesAppSettingsExtras = {}
): TaskNotesAppSettingsValues {
	const templatePath = extras.templating?.templatePath?.trim() ?? "";
	const occurrenceTemplatePath = extras.templating?.occurrenceTemplatePath?.trim() ?? "";
	const statusBehavior: Record<string, TaskNotesStatusBehavior> = {};
	for (const status of config.statuses) {
		statusBehavior[status.value] = {
			...(status.nextStatus?.trim() ? { next_status: status.nextStatus.trim() } : {}),
			exclude_from_cycle: status.excludeFromCycle === true,
			auto_archive: status.autoArchive === true,
			auto_archive_delay_minutes: Number.isFinite(status.autoArchiveDelay)
				? status.autoArchiveDelay
				: TASKNOTES_DEFAULT_AUTO_ARCHIVE_DELAY,
		};
	}
	return {
		nlp_triggers: config.nlp
			? config.nlp.triggers.map((trigger) => ({
					property_id: trigger.propertyId,
					trigger: trigger.trigger,
					enabled: trigger.enabled,
				}))
			: null,
		template_enabled: extras.templating?.enabled === true && templatePath.length > 0,
		template_path: templatePath,
		occurrence_template_enabled:
			extras.templating?.occurrenceEnabled === true && occurrenceTemplatePath.length > 0,
		occurrence_template_path: occurrenceTemplatePath,
		template_failure_mode: null,
		template_unknown_variable_policy: null,
		move_on_archive: extras.archive?.moveOnArchive === true,
		archive_folder: extras.archive?.folder?.trim() ?? "",
		auto_stop_time_tracking_on_complete: config.timeTracking.autoStopOnComplete === true,
		reset_body_checkboxes_on_recurrence: config.recurrence.resetCheckboxesOnRecurrence === true,
		link_write_format: extras.links?.writeFormat ?? "wikilink",
		status_behavior: statusBehavior,
	};
}

/** A model configuration with the settings record's behaviour applied. */
export function applyTaskNotesAppSettingsToModelConfig<Config extends Pick<TaskNotesModelConfig, "statuses" | "recurrence" | "timeTracking" | "nlp">>(
	config: Config,
	values: Readonly<TaskNotesAppSettingsValues>
): Config {
	return {
		...config,
		statuses: config.statuses.map((status): StatusConfig => {
			const behavior = taskNotesStatusBehavior(values, status);
			const result: StatusConfig = {
				...status,
				excludeFromCycle: behavior.exclude_from_cycle,
				autoArchive: behavior.auto_archive,
				autoArchiveDelay: behavior.auto_archive_delay_minutes,
			};
			if (behavior.next_status) result.nextStatus = behavior.next_status;
			else delete result.nextStatus;
			return result;
		}),
		recurrence: {
			...config.recurrence,
			resetCheckboxesOnRecurrence: values.reset_body_checkboxes_on_recurrence,
		},
		timeTracking: {
			...config.timeTracking,
			autoStopOnComplete: values.auto_stop_time_tracking_on_complete,
		},
		...(values.nlp_triggers
			? {
					nlp: {
						triggers: values.nlp_triggers.map((trigger) => ({
							propertyId: trigger.property_id,
							trigger: trigger.trigger,
							enabled: trigger.enabled,
						})),
					},
				}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Published artifacts: the tasknotes.settings contract, schema and type.

const nonEmptyStringSchema = { type: "string", minLength: 1 } as const;

export const TASKNOTES_SETTINGS_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	title: "tasknotes.settings 1.0.0",
	description:
		"Collection-wide behaviour that every TaskNotes client honours. Every field is optional and has a default, so a record with none of them behaves like no record at all.",
	type: "object",
	required: ["app", "scope", "settings_version"],
	properties: {
		app: { const: TASKNOTES_SETTINGS_APP, description: "Marks this record as TaskNotes' settings." },
		scope: { const: "collection", description: "These settings apply to everyone using TaskNotes in this collection." },
		settings_version: {
			type: "integer",
			minimum: 1,
			description: "The version of these settings that last wrote the record. TaskNotes writes 1.",
		},
		nlp_triggers: {
			type: "array",
			items: {
				type: "object",
				required: ["property_id", "trigger", "enabled"],
				properties: {
					property_id: nonEmptyStringSchema,
					trigger: nonEmptyStringSchema,
					enabled: { type: "boolean" },
				},
				additionalProperties: false,
			},
			description: "Natural-language capture triggers, such as @ for contexts. Without the field each client uses its own defaults.",
		},
		template_enabled: { type: "boolean", default: false, description: "Apply template_path to the body of new tasks." },
		template_path: { type: "string", description: "The template for new task bodies. Empty or absent means none." },
		occurrence_template_enabled: { type: "boolean", default: false, description: "Apply occurrence_template_path to new materialized occurrences." },
		occurrence_template_path: { type: "string", description: "The template for new occurrence bodies. Empty or absent means none." },
		template_failure_mode: { enum: ["error", "warning_fallback"], description: "What a client does when a template cannot be applied." },
		template_unknown_variable_policy: { enum: ["preserve", "empty"], description: "What a client writes for a template variable it does not know." },
		move_on_archive: { type: "boolean", default: false, description: "Move a task's file to archive_folder when it is archived." },
		archive_folder: { type: "string", description: "Where archived tasks move to. Empty or absent means the client's default." },
		auto_stop_time_tracking_on_complete: { type: "boolean", default: false, description: "Stop a running timer when its task is completed." },
		reset_body_checkboxes_on_recurrence: { type: "boolean", default: false, description: "Uncheck body checkboxes when a recurring task moves to its next occurrence." },
		link_write_format: { enum: ["wikilink", "markdown"], default: "wikilink", description: "How clients write links into task frontmatter. Both formats are always read." },
		status_behavior: {
			type: "object",
			description:
				"Behaviour per status value. A status without an entry has no next status and no auto-archive, and is out of the status cycle exactly when it is a skipped status.",
			additionalProperties: {
				type: "object",
				properties: {
					next_status: { ...nonEmptyStringSchema, description: "The status the cycle moves to next." },
					exclude_from_cycle: { type: "boolean", description: "Leave this status out of the status cycle." },
					auto_archive: { type: "boolean", description: "Archive a task some time after it takes this status." },
					auto_archive_delay_minutes: { type: "number", minimum: 0, description: "How long after taking this status a task is archived." },
				},
				additionalProperties: false,
			},
			default: {},
		},
	},
	additionalProperties: true,
} as const;

export interface TaskNotesSettingsResources {
	contract: Record<string, unknown>;
	contractDocument: string;
	schemaDocument: string;
	type: Record<string, unknown>;
	typeDocument: string;
	paths: {
		/** Pack source and target of the contract, schema and type. */
		contract: string;
		schema: string;
		type: string;
		record: string;
	};
}

/**
 * The tasknotes.settings contract, its schema, and the tasknotes-settings
 * type that implements it and mdbase.app-settings, laid out as published in
 * mdbase-contracts.
 */
export function buildTaskNotesSettingsResources(
	options: { typesFolder?: string; contractsFolder?: string } = {}
): TaskNotesSettingsResources {
	const typesFolder = options.typesFolder ?? "_types";
	const contractsFolder = options.contractsFolder ?? "_contracts";
	const version = TASKNOTES_SETTINGS_CONTRACT_VERSION;
	const contract = {
		kind: "mdbase.contract",
		contract_type: "record",
		id: TASKNOTES_SETTINGS_CONTRACT_ID,
		version,
		name: "TaskNotes settings",
		description: "Collection-wide TaskNotes behaviour, such as templates, archive moves and status cycling.",
		record_schema: {
			dialect: "json-schema-2020-12",
			ref: `../../schemas/${TASKNOTES_SETTINGS_CONTRACT_ID}/${version}.schema.json`,
		},
	};
	const contractDocument = [
		"---",
		YAML.stringify(contract, { lineWidth: 0 }).trimEnd(),
		"---",
		"",
		"# TaskNotes settings",
		"",
		`The collection's settings record for TaskNotes, at \`${TASKNOTES_SETTINGS_PATH}\`.`,
		"It also implements `mdbase.app-settings`, whose reserved fields (`app`, `scope`,",
		"`settings_version`) it shares.",
		"",
		"These settings change what TaskNotes clients do, never what a task record",
		"means: that stays in the `tasknotes.task` binding of each task type.",
		"`tasknotes.task` 0.3.0-rc.6 moved them here from the binding. A client reads",
		"each setting from this record, then from an earlier binding that still holds",
		"it, then uses its default, so a collection whose task type is still on rc.5",
		"keeps its behaviour until it is upgraded.",
		"",
		"## Fields",
		"",
		"- `nlp_triggers`: natural-language capture triggers. Without it, each client",
		"  uses its own defaults.",
		"- `template_enabled`, `template_path`, `occurrence_template_enabled`,",
		"  `occurrence_template_path`, `template_failure_mode`,",
		"  `template_unknown_variable_policy`: body templates for new tasks and",
		"  materialized occurrences.",
		"- `move_on_archive`, `archive_folder`: whether archiving moves the file, and",
		"  where to.",
		"- `auto_stop_time_tracking_on_complete`: stop a running timer on completion.",
		"- `reset_body_checkboxes_on_recurrence`: uncheck body checkboxes when a",
		"  recurring task advances.",
		"- `link_write_format`: `wikilink` or `markdown` for links written to task",
		"  frontmatter.",
		"- `status_behavior`: per status value, `next_status`, `exclude_from_cycle`,",
		"  `auto_archive` and `auto_archive_delay_minutes`. A status without an entry",
		"  has no next status and no auto-archive (5 minute delay), and is out of the",
		"  cycle exactly when it is a skipped status.",
		"",
		"## Authority",
		"",
		"This artifact is passive and grants nothing.",
		"",
	].join("\n");
	const reserved = { app: "app", scope: "scope", settings_version: "settings_version" };
	const type = {
		kind: "mdbase.type",
		name: TASKNOTES_SETTINGS_TYPE,
		version: TASKNOTES_SETTINGS_TYPE_VERSION,
		description: `TaskNotes' collection-wide settings, one record at ${TASKNOTES_SETTINGS_PATH}.`,
		match: { where: { app: { eq: TASKNOTES_SETTINGS_APP } } },
		schema: { dialect: "json-schema-2020-12", value: cloneValue(TASKNOTES_SETTINGS_SCHEMA) },
		collection: { unique: [{ field: "app", scope: "type" }] },
		implements: [
			{ contract: APP_SETTINGS_CONTRACT_ID, version: APP_SETTINGS_CONTRACT_VERSION, fields: { ...reserved } },
			{
				contract: TASKNOTES_SETTINGS_CONTRACT_ID,
				version,
				fields: {
					...reserved,
					...Object.fromEntries(TASKNOTES_APP_SETTING_KEYS.map((key) => [key, key])),
				},
			},
		],
	};
	const typeDocument = [
		"---",
		YAML.stringify(type, { lineWidth: 0 }).trimEnd(),
		"---",
		"",
		"# TaskNotes settings",
		"",
		"Settings that every TaskNotes client honours in this collection, such as body",
		"templates, archive moves and status cycling. TaskNotes reads them from",
		`\`${TASKNOTES_SETTINGS_PATH}\` and writes only the fields a save changes.`,
		"",
	].join("\n");
	return {
		contract,
		contractDocument,
		schemaDocument: `${JSON.stringify(TASKNOTES_SETTINGS_SCHEMA, null, 2)}\n`,
		type,
		typeDocument,
		paths: {
			contract: `${contractsFolder}/${TASKNOTES_SETTINGS_CONTRACT_ID}/${version}.md`,
			schema: `schemas/${TASKNOTES_SETTINGS_CONTRACT_ID}/${version}.schema.json`,
			type: `${typesFolder}/${TASKNOTES_SETTINGS_TYPE}.md`,
			record: TASKNOTES_SETTINGS_PATH,
		},
	};
}

function fieldEntries<Values extends object>(
	definition: AppSettingsDefinition<Values>
): [string, AppSettingField<unknown>][] {
	return Object.entries(definition.fields);
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
	if (Array.isArray(value)) return value.map(cloneValue) as T;
	if (isRecord(value)) {
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T;
	}
	return value;
}
