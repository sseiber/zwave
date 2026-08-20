import { HealthState, NodeHealthState } from '@zwave-service/contracts';

//
// The shared vocabulary for health: what colour a state is, and what it is called.
// It lives here rather than in the Health view because the Dashboard says the same
// things in fewer words, and both must say them identically — a device that is amber
// on one screen cannot be green on the other.
//

export function toneFor(state: HealthState): string {
    return state === HealthState.Good ? 'good' : state === HealthState.Fair ? 'warn' : 'bad';
}

// Phrased as a conclusion the user can act on, not a grade they have to interpret
export function stateLabel(state: HealthState): string {
    switch (state) {
        case HealthState.Good:
            return 'Working normally';
        case HealthState.Fair:
            return 'One thing to check';
        default:
            return 'Action needed';
    }
}

export function nodeTone(state: NodeHealthState): string {
    switch (state) {
        case NodeHealthState.Good:
            return 'good';
        case NodeHealthState.Fair:
        case NodeHealthState.Poor:
            return 'warn';
        case NodeHealthState.Offline:
            return 'bad';
        default:
            return 'unknown';
    }
}

// Worst first, so a strip of dots reads left-to-right as problems then healthy devices
export function nodeRank(state: NodeHealthState): number {
    switch (state) {
        case NodeHealthState.Offline:
            return 0;
        case NodeHealthState.Poor:
            return 1;
        case NodeHealthState.Fair:
            return 2;
        case NodeHealthState.Good:
            return 3;
        default:
            return 4;
    }
}
