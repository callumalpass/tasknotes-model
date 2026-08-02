export interface AttachmentReferenceIssue {
	code: "invalid_attachment_reference" | "duplicate_attachment_reference";
	message: string;
	index: number;
	reference?: string;
}

export interface AttachmentReferenceValidation {
	valid: boolean;
	issues: AttachmentReferenceIssue[];
}

/**
 * Normalize scalar compatibility input to the canonical runtime list shape.
 * Invalid entries are retained (trimmed) so validation can report them rather
 * than silently changing task membership.
 */
export function normalizeAttachmentList(value: unknown): string[] | undefined {
	if (value === null || value === undefined) return undefined;
	const values = Array.isArray(value) ? value : [value];
	const normalized = values
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

/** Return a safe, normalized collection-relative path for one reference. */
export function attachmentPathFromReference(
	reference: string,
	sourcePath = ""
): string | undefined {
	let target = reference.trim();
	let format: "wikilink" | "markdown" | "path" = "path";
	const wikilink = target.match(/^\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]$/);
	if (wikilink) {
		format = "wikilink";
		target = wikilink[1].trim();
	} else {
		const markdownLink = target.match(/^\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)$/);
		if (markdownLink) {
			format = "markdown";
			target = markdownLink[1].trim();
		}
	}

	try {
		target = decodeURI(target);
	} catch {
		return undefined;
	}
	target = target.replace(/\\/g, "/");
	if (!target || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)) return undefined;

	const fromRoot = target.startsWith("/") ||
		(format === "wikilink" && !target.startsWith("./") && !target.startsWith("../"));
	const sourceSegments = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
	if (sourceSegments.length > 0) sourceSegments.pop();
	const segments: string[] = fromRoot ? [] : sourceSegments;
	for (const segment of target.replace(/^\/+/, "").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return undefined;
			segments.pop();
			continue;
		}
		if (segment.includes("\0") || segment.includes("[") || segment.includes("]")) {
			return undefined;
		}
		segments.push(segment);
	}
	if (segments.length === 0) return undefined;

	const filename = segments[segments.length - 1] ?? "";
	if (!/^.+\.[^.]+$/.test(filename)) return undefined;
	return segments.join("/");
}

export function canonicalAttachmentReference(path: string): string {
	const normalized = normalizeCollectionPath(path);
	if (!normalized) throw new Error(`Invalid attachment path: ${path}`);
	return `[[${normalized}]]`;
}

export function validateAttachmentReferences(
	attachments: readonly string[] | undefined,
	sourcePath = ""
): AttachmentReferenceValidation {
	const issues: AttachmentReferenceIssue[] = [];
	const seen = new Set<string>();
	for (const [index, reference] of (attachments ?? []).entries()) {
		const path = attachmentPathFromReference(reference, sourcePath);
		if (!path) {
			issues.push({
				code: "invalid_attachment_reference",
				message: "Attachment references must identify a collection file using an explicit extension",
				index,
				reference,
			});
			continue;
		}
		if (seen.has(path)) {
			issues.push({
				code: "duplicate_attachment_reference",
				message: `Attachment target is listed more than once: ${path}`,
				index,
				reference,
			});
			continue;
		}
		seen.add(path);
	}
	return { valid: issues.length === 0, issues };
}

function normalizeCollectionPath(path: string): string | undefined {
	const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized || normalized.startsWith("./") || normalized.startsWith("../")) {
		return undefined;
	}
	if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(normalized)) return undefined;
	const segments = normalized.split("/");
	if (
		segments.some(
			(segment) =>
				!segment ||
				segment === "." ||
				segment === ".." ||
				segment.includes("\0") ||
				segment.includes("[") ||
				segment.includes("]")
		)
	) {
		return undefined;
	}
	const filename = segments[segments.length - 1] ?? "";
	return /^.+\.[^.]+$/.test(filename) ? segments.join("/") : undefined;
}
