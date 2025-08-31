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

    let currentHandlers: {
        loading?: (...args: TArgs) => void;
        success?: (data: TResult, ...args: TArgs) => void;
        error?: (err: string, ...args: TArgs) => void;
        finally?: () => void;
    } = {};

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
        const handlers = currentHandlers;
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
                    error.set(err);
                    status.set('error');
                    if (options.track !== false) tracker.error(id, err);
                    options.onError?.(err, ...args);
                    handlers.error?.(err, ...args);
                    handlers.finally?.();
                    subscriber.complete();
                },
            });

            return () => sub.unsubscribe();
        });
    }

    const run = (...args: TArgs): ActionHandlers<TArgs, TResult> => {
        currentHandlers = {};
        const chainableHandlers: ActionHandlers<TArgs, TResult> = {
            onLoading: cb => {
                currentHandlers.loading = cb;
                return chainableHandlers;
            },
            onSuccess: cb => {
                currentHandlers.success = cb;
                return chainableHandlers;
            },
            onError: cb => {
                currentHandlers.error = cb;
                return chainableHandlers;
            },
            finally: cb => {
                currentHandlers.finally = cb;
                return chainableHandlers;
            },
            continueWith: <TNextResult>(
                nextActionFn: (data: TResult, ...args: TArgs) => ActionHandlers<any[], TNextResult>
            ): ActionHandlers<TArgs, TNextResult> => {
                const originalSuccess = currentHandlers.success;
                currentHandlers.success = (data: TResult, ...originalArgs: TArgs) => {
                    originalSuccess?.(data, ...originalArgs);
                    nextActionFn(data, ...originalArgs);
                };
                return chainableHandlers as any;
            },
        };

        setTimeout(() => {
            if (options.debounceMs) {
                runSubject.next(args);
            } else {
                if (currentSub) currentSub.unsubscribe();
                currentSub = executeObservable(...args).subscribe();
            }
        }, 0);

        return chainableHandlers;
    };

    return { status, error, isLoading, isSuccess, isError, run };
}

export function createSignalAction<TArgs extends unknown[], TResult>(
    observableFn: (...args: TArgs) => Observable<TResult>,
    options?: ActionOptions<TArgs, TResult>
): SignalAction<TArgs, TResult> {
    return createBaseAction(observableFn, options);
}

export function createSignalForkJoinAction<TRequest, TResult extends Record<string, unknown>>(
    observablesFn: (request: TRequest) => Record<keyof TResult, Observable<unknown>>,
    options?: ActionOptions<[TRequest], TResult>
): SignalAction<[TRequest], TResult> {
    return createBaseAction((request: TRequest) => forkJoin(observablesFn(request)) as Observable<TResult>, options);
}