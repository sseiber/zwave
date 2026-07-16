import { getTimes } from 'suncalc';
import {
    ISchedule,
    ITimeOfDay,
    ScheduleKind,
    IntervalUnit,
    TimeOfDayKind
} from '../models/index.js';

//
// Schedule evaluation helpers. Named exports only so @fastify/autoload skips this file.
//
// All times are evaluated in the process's local timezone, so the container should
// have TZ set (otherwise it is UTC and "19:00" means 19:00 UTC).
//

export interface IGeoLocation {
    latitude: number;
    longitude: number;
}

const UNIT_MS: Record<IntervalUnit, number> = {
    [IntervalUnit.Seconds]: 1000,
    [IntervalUnit.Minutes]: 60 * 1000,
    [IntervalUnit.Hours]: 60 * 60 * 1000,
    [IntervalUnit.Days]: 24 * 60 * 60 * 1000
};

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Latitude/longitude are optional and only needed for sunrise/sunset schedules, so
// they are read straight from the environment (same pattern as the security keys).
export function getGeoLocation(): IGeoLocation | undefined {
    const latitude = Number(process.env.zwaveLatitude);
    const longitude = Number(process.env.zwaveLongitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return undefined;
    }

    return { latitude, longitude };
}

// Returns an error message when the schedule is unusable, otherwise undefined.
export function validateSchedule(schedule: ISchedule | undefined, geo: IGeoLocation | undefined): string | undefined {
    if (!schedule) {
        return `A 'schedule' is required when trigger is 'scheduled'`;
    }

    switch (schedule.kind) {
        case ScheduleKind.Interval:
            if (!schedule.every || schedule.every <= 0) {
                return `An interval schedule requires 'every' to be greater than 0`;
            }
            if (!schedule.unit || !(schedule.unit in UNIT_MS)) {
                return `An interval schedule requires a valid 'unit'`;
            }

            return undefined;

        case ScheduleKind.Daily:
            return validateTimeOfDay(schedule.timeOfDay, geo);

        case ScheduleKind.Weekly:
            if (!schedule.daysOfWeek?.length) {
                return `A weekly schedule requires at least one day in 'daysOfWeek'`;
            }
            if (schedule.daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
                return `'daysOfWeek' entries must be integers 0 (Sunday) - 6 (Saturday)`;
            }

            return validateTimeOfDay(schedule.timeOfDay, geo);

        case ScheduleKind.Monthly:
            if (!schedule.daysOfMonth?.length) {
                return `A monthly schedule requires at least one day in 'daysOfMonth'`;
            }
            if (schedule.daysOfMonth.some(day => !Number.isInteger(day) || day < 1 || day > 31)) {
                return `'daysOfMonth' entries must be integers 1 - 31`;
            }

            return validateTimeOfDay(schedule.timeOfDay, geo);

        case ScheduleKind.Once: {
            if (!schedule.at) {
                return `A one-time schedule requires 'at'`;
            }

            const at = new Date(schedule.at);
            if (Number.isNaN(at.getTime())) {
                return `'at' must be a valid date-time`;
            }
            if (at.getTime() <= Date.now()) {
                return `'at' must be in the future`;
            }

            return undefined;
        }

        default:
            return `Unrecognized schedule kind '${String(schedule.kind)}'`;
    }
}

function validateTimeOfDay(timeOfDay: ITimeOfDay | undefined, geo: IGeoLocation | undefined): string | undefined {
    if (!timeOfDay) {
        return `This schedule requires a 'timeOfDay'`;
    }

    if (timeOfDay.kind === TimeOfDayKind.Clock) {
        if (!timeOfDay.time || !CLOCK_PATTERN.test(timeOfDay.time)) {
            return `'timeOfDay.time' must be a 24h 'HH:MM' value`;
        }

        return undefined;
    }

    if (timeOfDay.kind === TimeOfDayKind.Sunrise || timeOfDay.kind === TimeOfDayKind.Sunset) {
        if (!geo) {
            return `Sunrise/sunset schedules need zwaveLatitude and zwaveLongitude to be configured`;
        }

        return undefined;
    }

    return `Unrecognized timeOfDay kind '${String(timeOfDay.kind)}'`;
}

// The next time this schedule should fire strictly after `from`, or undefined if it
// never will (an unusable schedule, or a one-time schedule already in the past).
export function computeNextRun(schedule: ISchedule, from: Date, geo: IGeoLocation | undefined): Date | undefined {
    switch (schedule.kind) {
        case ScheduleKind.Interval: {
            if (!schedule.every || schedule.every <= 0 || !schedule.unit || !(schedule.unit in UNIT_MS)) {
                return undefined;
            }

            return new Date(from.getTime() + (schedule.every * UNIT_MS[schedule.unit]));
        }

        case ScheduleKind.Once: {
            if (!schedule.at) {
                return undefined;
            }

            const at = new Date(schedule.at);

            return (Number.isNaN(at.getTime()) || at.getTime() <= from.getTime()) ? undefined : at;
        }

        case ScheduleKind.Daily:
            // Today or tomorrow
            return findNextMatchingDay(from, 2, () => true, schedule.timeOfDay, geo);

        case ScheduleKind.Weekly: {
            const daysOfWeek = schedule.daysOfWeek ?? [];
            if (!daysOfWeek.length) {
                return undefined;
            }

            return findNextMatchingDay(from, 8, day => daysOfWeek.includes(day.getDay()), schedule.timeOfDay, geo);
        }

        case ScheduleKind.Monthly: {
            const daysOfMonth = schedule.daysOfMonth ?? [];
            if (!daysOfMonth.length) {
                return undefined;
            }

            // Look far enough ahead to cross a month boundary (e.g. only the 31st selected)
            return findNextMatchingDay(from, 70, day => daysOfMonth.includes(day.getDate()), schedule.timeOfDay, geo);
        }

        default:
            return undefined;
    }
}

function findNextMatchingDay(
    from: Date,
    horizonDays: number,
    matches: (day: Date) => boolean,
    timeOfDay: ITimeOfDay | undefined,
    geo: IGeoLocation | undefined
): Date | undefined {
    if (!timeOfDay) {
        return undefined;
    }

    for (let offset = 0; offset < horizonDays; offset++) {
        const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
        if (!matches(day)) {
            continue;
        }

        const candidate = resolveTimeOnDate(timeOfDay, day, geo);
        if (candidate && candidate.getTime() > from.getTime()) {
            return candidate;
        }
    }

    return undefined;
}

function resolveTimeOnDate(timeOfDay: ITimeOfDay, day: Date, geo: IGeoLocation | undefined): Date | undefined {
    if (timeOfDay.kind === TimeOfDayKind.Clock) {
        const match = CLOCK_PATTERN.exec(timeOfDay.time ?? '');
        if (!match) {
            return undefined;
        }

        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2]), 0, 0);
    }

    if (!geo) {
        return undefined;
    }

    // Solar times for the given calendar day (noon avoids any DST edge on the boundary)
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0);
    const times = getTimes(noon, geo.latitude, geo.longitude);
    const base = timeOfDay.kind === TimeOfDayKind.Sunrise ? times.sunrise : times.sunset;

    // Polar day/night can leave these undefined
    if (!base || Number.isNaN(base.getTime())) {
        return undefined;
    }

    return new Date(base.getTime() + ((timeOfDay.offsetMinutes ?? 0) * 60 * 1000));
}
