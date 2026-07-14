export function exMessage(error: unknown): string {
    let message = 'An error occurred';

    if (error instanceof Error) {
        message = error.message;
    }
    else if (error && typeof error === 'object' && 'message' in error) {
        message = String(error.message);
    }
    else if (typeof error === 'string') {
        message = error;
    }

    return message;
}
