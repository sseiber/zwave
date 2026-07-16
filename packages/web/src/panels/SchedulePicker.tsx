import type { ISchedule, ITimeOfDay } from '@zwave-service/contracts';
import { ScheduleKind, IntervalUnit, TimeOfDayKind } from '@zwave-service/contracts';
import { DAY_NAMES, defaultSchedule, describeSchedule, toLocalInputValue, fromLocalInputValue } from '../schedule.ts';

interface SchedulePickerProps {
    schedule: ISchedule;
    onChange: (schedule: ISchedule) => void;
}

const KIND_LABELS: { kind: ScheduleKind; label: string }[] = [
    { kind: ScheduleKind.Interval, label: 'Interval' },
    { kind: ScheduleKind.Daily, label: 'Daily' },
    { kind: ScheduleKind.Weekly, label: 'Weekly' },
    { kind: ScheduleKind.Monthly, label: 'Monthly' },
    { kind: ScheduleKind.Once, label: 'One time' }
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function SchedulePicker({ schedule, onChange }: SchedulePickerProps) {
    const patch = (changes: Partial<ISchedule>): void => onChange({ ...schedule, ...changes });

    const toggleIn = (list: number[] | undefined, value: number): number[] => {
        const current = list ?? [];
        return current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    };

    return (
        <fieldset className="schedule">
            <legend>Schedule</legend>

            {/* Kind picker: the five groups, chosen first so only relevant fields show */}
            <div className="kinds">
                {KIND_LABELS.map(({ kind, label }) => (
                    <button
                        key={kind}
                        type="button"
                        className={schedule.kind === kind ? 'chip active' : 'chip'}
                        onClick={() => onChange(defaultSchedule(kind))}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {schedule.kind === ScheduleKind.Interval && (
                <div className="row">
                    <span className="lead">Every</span>
                    <input
                        type="number"
                        min={1}
                        className="num"
                        value={schedule.every ?? 1}
                        onChange={e => patch({ every: Math.max(1, Number(e.target.value)) })}
                        aria-label="Interval amount"
                    />
                    <select
                        value={schedule.unit ?? IntervalUnit.Minutes}
                        onChange={e => patch({ unit: e.target.value as IntervalUnit })}
                        aria-label="Interval unit"
                    >
                        <option value={IntervalUnit.Seconds}>seconds</option>
                        <option value={IntervalUnit.Minutes}>minutes</option>
                        <option value={IntervalUnit.Hours}>hours</option>
                        <option value={IntervalUnit.Days}>days</option>
                    </select>
                </div>
            )}

            {schedule.kind === ScheduleKind.Weekly && (
                <div className="row wrap">
                    <span className="lead">On</span>
                    {DAY_NAMES.map((day, index) => (
                        <button
                            key={day}
                            type="button"
                            className={schedule.daysOfWeek?.includes(index) ? 'chip active' : 'chip'}
                            onClick={() => patch({ daysOfWeek: toggleIn(schedule.daysOfWeek, index) })}
                        >
                            {day}
                        </button>
                    ))}
                </div>
            )}

            {schedule.kind === ScheduleKind.Monthly && (
                <div className="row wrap month-days">
                    <span className="lead">Days</span>
                    {MONTH_DAYS.map(day => (
                        <button
                            key={day}
                            type="button"
                            className={schedule.daysOfMonth?.includes(day) ? 'chip day active' : 'chip day'}
                            onClick={() => patch({ daysOfMonth: toggleIn(schedule.daysOfMonth, day) })}
                        >
                            {day}
                        </button>
                    ))}
                </div>
            )}

            {schedule.kind === ScheduleKind.Once && (
                <div className="row">
                    <span className="lead">At</span>
                    <input
                        type="datetime-local"
                        value={toLocalInputValue(schedule.at)}
                        onChange={e => patch({ at: fromLocalInputValue(e.target.value) })}
                        aria-label="Date and time"
                    />
                </div>
            )}

            {/* Daily/weekly/monthly all share the same time-of-day control */}
            {(schedule.kind === ScheduleKind.Daily
                || schedule.kind === ScheduleKind.Weekly
                || schedule.kind === ScheduleKind.Monthly) && (
                <TimeOfDayPicker
                    value={schedule.timeOfDay ?? { kind: TimeOfDayKind.Clock, time: '19:00' }}
                    onChange={timeOfDay => patch({ timeOfDay })}
                />
            )}

            <p className="summary">{describeSchedule(schedule)}</p>
        </fieldset>
    );
}

interface TimeOfDayPickerProps {
    value: ITimeOfDay;
    onChange: (value: ITimeOfDay) => void;
}

type Direction = 'at' | 'before' | 'after';

function TimeOfDayPicker({ value, onChange }: TimeOfDayPickerProps) {
    const offset = value.offsetMinutes ?? 0;
    const direction: Direction = offset === 0 ? 'at' : offset < 0 ? 'before' : 'after';
    const magnitude = Math.abs(offset);
    const hours = Math.floor(magnitude / 60);
    const minutes = magnitude % 60;
    const isSolar = value.kind !== TimeOfDayKind.Clock;

    const withOffset = (dir: Direction, h: number, m: number): number => {
        if (dir === 'at') {
            return 0;
        }
        const total = (Math.max(0, h) * 60) + Math.max(0, m);
        return dir === 'before' ? -total : total;
    };

    return (
        <div className="row wrap">
            <span className="lead">Time</span>

            <select
                value={value.kind}
                onChange={e => {
                    const kind = e.target.value as TimeOfDayKind;
                    onChange(kind === TimeOfDayKind.Clock
                        ? { kind, time: value.time ?? '19:00' }
                        : { kind, offsetMinutes: value.offsetMinutes ?? 0 });
                }}
                aria-label="Time of day type"
            >
                <option value={TimeOfDayKind.Clock}>At a time</option>
                <option value={TimeOfDayKind.Sunrise}>Sunrise</option>
                <option value={TimeOfDayKind.Sunset}>Sunset</option>
            </select>

            {!isSolar && (
                <input
                    type="time"
                    value={value.time ?? '19:00'}
                    onChange={e => onChange({ ...value, time: e.target.value })}
                    aria-label="Time"
                />
            )}

            {isSolar && (
                <>
                    <select
                        value={direction}
                        onChange={e => {
                            const dir = e.target.value as Direction;
                            // Default a fresh offset to 30m so "before/after" means something
                            const h = dir === 'at' ? 0 : hours;
                            const m = dir === 'at' ? 0 : (magnitude === 0 ? 30 : minutes);
                            onChange({ ...value, offsetMinutes: withOffset(dir, h, m) });
                        }}
                        aria-label="Offset direction"
                    >
                        <option value="at">At</option>
                        <option value="before">Before</option>
                        <option value="after">After</option>
                    </select>

                    {direction !== 'at' && (
                        <>
                            <input
                                type="number"
                                min={0}
                                max={12}
                                className="num"
                                value={hours}
                                onChange={e => onChange({ ...value, offsetMinutes: withOffset(direction, Number(e.target.value), minutes) })}
                                aria-label="Offset hours"
                            />
                            <span className="unit">h</span>
                            <input
                                type="number"
                                min={0}
                                max={59}
                                className="num"
                                value={minutes}
                                onChange={e => onChange({ ...value, offsetMinutes: withOffset(direction, hours, Number(e.target.value)) })}
                                aria-label="Offset minutes"
                            />
                            <span className="unit">m</span>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
