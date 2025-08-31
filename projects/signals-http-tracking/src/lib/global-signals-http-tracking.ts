import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GlobalHttpTracker {
    private readonly _pending = signal(new Set<string>());
    private readonly _lastError = signal<string | null>(null);

    readonly pendingCount = computed(() => this._pending().size);
    readonly isAnyLoading = computed(() => this.pendingCount() > 0);
    readonly lastError = computed(() => this._lastError());

    begin(id: string) {
        const s = new Set(this._pending());
        s.add(id);
        this._pending.set(s);
    }

    success(id: string) {
        const s = new Set(this._pending());
        s.delete(id);
        this._pending.set(s);
    }

    error(id: string, msg: string) {
        const s = new Set(this._pending());
        s.delete(id);
        this._pending.set(s);
        this._lastError.set(msg);
    }

    clearError() {
        this._lastError.set(null);
    }
}
