// Calendar dates are civil values in an explicit IANA zone, never the process zone.
const DAY = 86_400_000;
const CIVIL = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

export function calendarDay(value: string): string {
	return value.slice(0, 10);
}

export function addCalendarDays(day: string, days: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function calendarDaysBetween(start: string, end: string): number {
	return (
		(Date.parse(`${calendarDay(end)}T00:00:00Z`) - Date.parse(`${calendarDay(start)}T00:00:00Z`)) /
		DAY
	);
}

function formatter(timezone: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
}

function civilAt(ms: number, format: Intl.DateTimeFormat): string {
	const p = Object.fromEntries(format.formatToParts(ms).map(({ type, value }) => [type, value]));
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Date-only/floating values use timezone. Offset values are instants.
 * DST overlaps choose the earlier instant; gaps move forward (Date-compatible).
 */
export function calendarDateToInstant(value: string, timezone: string): number {
	const match = CIVIL.exec(value);
	if (!match) {
		if (!/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) throw new Error("invalid-calendar-date");
		const ms = Date.parse(value);
		if (!Number.isFinite(ms)) throw new Error("invalid-calendar-date");
		return ms;
	}
	const [, day, hour = "00", minute = "00", second = "00", fraction = "0"] = match;
	const civil = `${day}T${hour}:${minute}:${second}`;
	const wall = Date.parse(`${civil}Z`);
	if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== civil) {
		throw new Error("invalid-calendar-date");
	}
	const format = formatter(timezone);
	const offsets = new Set<number>();
	for (const delta of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
		const probe = wall + delta;
		offsets.add(Date.parse(`${civilAt(probe, format)}Z`) - probe);
	}
	const candidates = [...offsets].map((offset) => wall - offset);
	const matching = candidates.filter((ms) => civilAt(ms, format) === civil);
	return (
		(matching.length ? Math.min(...matching) : Math.max(...candidates)) +
		Number(fraction.padEnd(3, "0"))
	);
}

export function calendarInstantToDate(ms: number, timezone: string, allDay = false): string {
	const civil = civilAt(ms, formatter(timezone));
	return civil.slice(0, allDay ? 10 : 16);
}
