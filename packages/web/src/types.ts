// Runs an API call, surfacing errors/status in the app shell.
// Resolves true when the call succeeded, so callers can refresh or close a form.
export type RunFn = (fn: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;
