import type { ISchedule, ITimeOfDay } from '@zwave-service/contracts';
import { ScheduleKind, IntervalUnit, TimeOfDayKind } from '@zwave-service/contracts';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A sensible starting point when the user picks a schedule kind
export function defaultSchedule(kind: ScheduleKind): ISchedule {
    const atSeven: ITimeOfDay = { kind: TimeOfDayKind.Clock, time: '19:00' };

    switch (kind) {
        case ScheduleKind.Interval:
            return { kind, every: 30, unit: IntervalUnit.Minutes };
        case ScheduleKind.Weekly:
            return { kind, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: atSeven };
        case ScheduleKind.Monthly:
            return { kind, daysOfMonth: [1], timeOfDay: atSeven };
        case ScheduleKind.Once:
            return { kind };
        case ScheduleKind.Daily:
        default:
            return { kind: ScheduleKind.Daily, timeOfDay: atSeven };
    }
}

export function describeTimeOfDay(timeOfDay: ITimeOfDay | undefined): string {
    if (!timeOfDay) {
        return '';
    }

    if (timeOfDay.kind === TimeOfDayKind.Clock) {
        return `at ${timeOfDay.time ?? '--:--'}`;
    }

    const event = timeOfDay.kind === TimeOfDayKind.Sunrise ? 'sunrise' : 'sunset';
    const offset = timeOfDay.offsetMinutes ?? 0;
    if (offset === 0) {
        return `at ${event}`;
    }

    const magnitude = Math.abs(offset);
    const hours = Math.floor(magnitude / 60);
    const minutes = magnitude % 60;
    const parts = [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null].filter(Boolean).join(' ');

    return `${parts} ${offset < 0 ? 'before' : 'after'} ${event}`;
}

export function describeSchedule(schedule: ISchedule | undefined): string {
    if (!schedule) {
        return 'No schedule';
    }

    switch (schedule.kind) {
        case ScheduleKind.Interval: {
            const every = schedule.every ?? 0;
            const unit = schedule.unit ?? '';
            // "Every 1 minute" rather than "Every 1 minutes"
            return `Every ${every} ${every === 1 ? unit.replace(/s$/, '') : unit}`.trim();
        }

        case ScheduleKind.Daily:
            return `Daily ${describeTimeOfDay(schedule.timeOfDay)}`.trim();

        case ScheduleKind.Weekly: {
            const days = [...(schedule.daysOfWeek ?? [])].sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ');
            return `${days || 'No days'} ${describeTimeOfDay(schedule.timeOfDay)}`.trim();
        }

        case ScheduleKind.Monthly: {
            const days = [...(schedule.daysOfMonth ?? [])].sort((a, b) => a - b).join(', ');
            return `Monthly on ${days || '--'} ${describeTimeOfDay(schedule.timeOfDay)}`.trim();
        }

        case ScheduleKind.Once: {
            if (!schedule.at) {
                return 'Once (no date set)';
            }
            const at = new Date(schedule.at);
            return Number.isNaN(at.getTime()) ? 'Once' : `Once on ${at.toLocaleString()}`;
        }

        default:
            return 'Unknown schedule';
    }
}

// <input type="datetime-local"> works in local time; the contract carries ISO
function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function toLocalInputValue(iso: string | undefined): string {
    if (!iso) {
        return '';
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
