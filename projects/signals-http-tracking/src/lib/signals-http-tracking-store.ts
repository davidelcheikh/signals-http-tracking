import { inject, computed, signal, WritableSignal, Signal } from '@angular/core';
import { Observable, Subscription, forkJoin, Subject } from 'rxjs';
import { debounceTime, switchMap } from 'rxjs/operators';
import { GlobalHttpTracker } from './global-signals-http-tracking';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface SignalAction<TArgs extends unknown[], TResult> {
    readonly status: WritableSignal<AsyncStatus>;
    readonly error: WritableSignal<string | null>;
    readonly isLoading: Signal<boolean>;
    readonly isSuccess: Signal<boolean>;
    readonly isError: Signal<boolean>;
    readonly run: (...args: TArgs) => ActionHandlers<TArgs, TResult>;
}

export interface ActionHandlers<TArgs extends unknown[], TResult> {
    onLoading: (cb: (...args: TArgs) => void) => ActionHandlers<TArgs, TResult>;
    onSuccess: (cb: (data: TResult, ...args: TArgs) => void) => ActionHandlers<TArgs, TResult>;
    onError: (cb: (err: string, ...args: TArgs) => void) => ActionHandlers<TArgs, TResult>;
    finally: (cb: () => void) => ActionHandlers<TArgs, TResult>;
    continueWith: <TNextResult>(
        nextActionFn: (data: TResult, ...args: TArgs) => ActionHandlers<any[], TNextResult>
    ) => ActionHandlers<TArgs, TNextResult>;
}

interface ActionOptions<TArgs extends unknown[], TResult> {
    track?: boolean;
    debounceMs?: number;
    onLoading?: (...args: TArgs) => void;
    onSuccess?: (data: TResult, ...args: TArgs) => void;
    onError?: (error: string, ...args: TArgs) => void;
}

function createBaseAction<TArgs extends unknown[], TResult>(
    getObservable: (...args: TArgs) => Observable<TResult>,
    options: ActionOptions<TArgs, TResult> = {}
): SignalAction<TArgs, TResult> {
    const tracker = inject(GlobalHttpTracker);
    const status = signal<AsyncStatus>('idle');
    const error = signal<string | null>(null);

    const isLoading = computed(() => status() === 'loading');
    const isSuccess = computed(() => status() === 'success');
    const isError = computed(() => status() === 'error');

    let currentSub: Subscription | null = null;
    const runSubject = new Subject<TArgs>();

    // Set up debounced stream if debounceMs is provided
    if (options.debounceMs) {
        currentSub = runSubject
            .pipe(
                debounceTime(options.debounceMs),
                switchMap(args => {
                    return executeObservable(...args);
                })
            )
            .subscribe();
    }

    function executeObservable(...args: TArgs): Observable<never> {
        const handlers: {
            loading?: (...args: TArgs) => void;
            success?: (data: TResult, ...args: TArgs) => void;
            error?: (err: string, ...args: TArgs) => void;
            finally?: () => void;
        } = {};

        status.set('loading');
        error.set(null);

        const id = crypto.randomUUID();
        if (options.track !== false) tracker.begin(id);

        queueMicrotask(() => {
            options.onLoading?.(...args);
            handlers.loading?.(...args);
        });

        return new Observable(subscriber => {
            const sub = getObservable(...args).subscribe({
                next: data => {
                    status.set('success');
                    if (options.track !== false) tracker.success(id);
                    options.onSuccess?.(data, ...args);
                    handlers.success?.(data, ...args);
                    handlers.finally?.();
                    subscriber.complete();
                },
                error: err => {
                    const msg = extractErrorMessage(err);
                    error.set(msg);
                    status.set('error');
                    if (options.track !== false) tracker.error(id, msg);
                    options.onError?.(msg, ...args);
                    handlers.error?.(msg, ...args);
                    handlers.finally?.();
                    subscriber.complete();
                },
            });

            return () => sub.unsubscribe();
        });
    }

    const run = (...args: TArgs): ActionHandlers<TArgs, TResult> => {
        const handlers: {
            loading?: (...args: TArgs) => void;
            success?: (data: TResult, ...args: TArgs) => void;
            error?: (err: string, ...args: TArgs) => void;
            finally?: () => void;
        } = {};

        if (options.debounceMs) {
            // Use debounced stream
            runSubject.next(args);
        } else {
            // Execute immediately
            if (currentSub) currentSub.unsubscribe();
            currentSub = executeObservable(...args).subscribe();
        }

        const chainableHandlers: ActionHandlers<TArgs, TResult> = {
            onLoading: cb => {
                handlers.loading = cb;
                return chainableHandlers;
            },
            onSuccess: cb => {
                handlers.success = cb;
                return chainableHandlers;
            },
            onError: cb => {
                handlers.error = cb;
                return chainableHandlers;
            },
            finally: cb => {
                handlers.finally = cb;
                return chainableHandlers;
            },
            continueWith: <TNextResult>(
                nextActionFn: (data: TResult, ...args: TArgs) => ActionHandlers<any[], TNextResult>
            ): ActionHandlers<TArgs, TNextResult> => {
                // Override the success handler to chain the next action
                const originalSuccess = handlers.success;
                handlers.success = (data: TResult, ...originalArgs: TArgs) => {
                    originalSuccess?.(data, ...originalArgs);
                    // Execute the next action with the result
                    nextActionFn(data, ...originalArgs);
                };

                return chainableHandlers as any; // Type assertion for chaining different result types
            },
        };

        return chainableHandlers;
    };

    return { status, error, isLoading, isSuccess, isError, run };
}

// Single observable
export function createSignalAction<TArgs extends unknown[], TResult>(
    observableFn: (...args: TArgs) => Observable<TResult>,
    options?: ActionOptions<TArgs, TResult>
): SignalAction<TArgs, TResult> {
    return createBaseAction(observableFn, options);
}

// Multiple observables - always takes a single object argument
export function createSignalForkJoinAction<TRequest, TResult extends Record<string, unknown>>(
    observablesFn: (request: TRequest) => Record<keyof TResult, Observable<unknown>>,
    options?: ActionOptions<[TRequest], TResult>
): SignalAction<[TRequest], TResult> {
    return createBaseAction((request: TRequest) => forkJoin(observablesFn(request)) as Observable<TResult>, options);
}

function extractErrorMessage(err: any): string {
    let errorMsg = '';
    if (err?.name === 'HttpErrorResponse' && typeof err.error === 'string') {
        errorMsg = err.error;
    } else if (err?.name === 'HttpErrorResponse' && typeof err?.error?.error === 'string') {
        errorMsg = err.error.error;
    }
    console.error(errorMsg);
    return errorMsg;
}
