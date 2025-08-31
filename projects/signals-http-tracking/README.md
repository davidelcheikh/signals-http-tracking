# Signal Actions HTTP Store

A TypeScript-first, reactive HTTP state management library built on Angular Signals. Provides clean APIs for single and multiple HTTP requests with built-in loading states, error handling, and debouncing.

## 🚀 Features

- **🔒 Full Type Safety** - Complete TypeScript inference and compile-time checks
- **⚡ Reactive Signals** - Built on Angular's signal system for optimal performance
- **📊 Automatic State Management** - Loading, success, error states handled automatically
- **🎯 HTTP Tracking Integration** - Works seamlessly with existing global HTTP trackers
- **⏱️ Built-in Debouncing** - Request debouncing using RxJS operators
- **🔄 ForkJoin Support** - Handle multiple parallel HTTP requests effortlessly
- **⛓️ Chainable API** - Fluent method chaining for better developer experience
- **🧹 Automatic Cleanup** - Subscription management handled internally

## 📦 Installation

```bash
npm install @your-org/signal-actions-http-store
```

## 🎯 Quick Start

### Single HTTP Request

```typescript
import { createSignalAction } from '@your-org/signal-actions-http-store';

@Injectable()
export class UserStore {
  private userService = inject(UserService);
  
  user = signal<User | null>(null);
  
  fetchUser = createSignalAction<[string], User>(
    (userId: string) => this.userService.getUser(userId),
    {
      onSuccess: (user) => this.user.set(user),
      onError: (error) => console.error('Failed to fetch user:', error)
    }
  );
}
```

### Multiple HTTP Requests (ForkJoin)

```typescript
getUserData = createSignalForkJoinAction<
  { userId: string }, 
  { user: User; posts: Post[] }
>(
  (request: { userId: string }) => ({
    user: this.userService.getUser(request.userId),
    posts: this.postService.getUserPosts(request.userId)
  }),
  {
    onSuccess: (result) => {
      this.user.set(result.user);
      this.posts.set(result.posts);
    }
  }
);
```

## 📖 API Reference

### `createSignalAction<TArgs, TResult>`

Creates a signal-based action for single HTTP requests.

**Parameters:**
- `observableFn: (...args: TArgs) => Observable<TResult>` - Function that returns an Observable
- `options?: ActionOptions<TArgs, TResult>` - Configuration options

**Returns:** `SignalAction<TArgs, TResult>`

### `createSignalForkJoinAction<TRequest, TResult>`

Creates a signal-based action for multiple parallel HTTP requests.

**Parameters:**
- `observablesFn: (request: TRequest) => Record<keyof TResult, Observable<any>>` - Function that returns an object of Observables
- `options?: ActionOptions<[TRequest], TResult>` - Configuration options

**Returns:** `SignalAction<[TRequest], TResult>`

### ActionOptions

```typescript
interface ActionOptions<TArgs, TResult> {
  track?: boolean;                                    // Enable/disable HTTP tracking (default: true)
  debounceMs?: number;                               // Debounce time in milliseconds
  onLoading?: (...args: TArgs) => void;              // Called when request starts
  onSuccess?: (data: TResult, ...args: TArgs) => void; // Called on successful response
  onError?: (error: string, ...args: TArgs) => void;   // Called on error
}
```

### SignalAction

```typescript
interface SignalAction<TArgs, TResult> {
  readonly status: WritableSignal<AsyncStatus>;      // Current status signal
  readonly error: WritableSignal<string | null>;     // Error message signal
  readonly isLoading: Signal<boolean>;               // Loading state signal
  readonly isSuccess: Signal<boolean>;               // Success state signal
  readonly isError: Signal<boolean>;                 // Error state signal
  readonly run: (...args: TArgs) => ActionHandlers<TArgs, TResult>; // Execute the action
}
```

## 🎨 Usage Examples

### Search with Debouncing

```typescript
searchUsers = createSignalAction<[string], User[]>(
  (query: string) => this.userService.searchUsers(query),
  {
    debounceMs: 300, // Wait 300ms after user stops typing
    onSuccess: (users) => this.searchResults.set(users),
    onError: (error) => this.snackbar.open(error)
  }
);

// In component
onSearchInput(query: string) {
  this.store.searchUsers.run(query);
}
```

### Complex Filtering with Different Parameters

```typescript
applyFilters = createSignalForkJoinAction<
  { userFilters: UserFilterRequest; postFilters: PostFilterRequest },
  { users: User[]; posts: Post[] }
>(
  (request: { userFilters: UserFilterRequest; postFilters: PostFilterRequest }) => ({
    users: this.userService.getFilteredUsers(request.userFilters),
    posts: this.postService.getFilteredPosts(request.postFilters)
  }),
  {
    debounceMs: 500, // Wait for user to finish adjusting filters
    onSuccess: (result) => {
      this.filteredUsers.set(result.users);
      this.filteredPosts.set(result.posts);
    }
  }
);
```

## 🎭 Template Usage

```typescript
<!-- In your component template -->
@if (store.fetchUser.isLoading()) {
  <app-spinner />
} @else if (store.fetchUser.isError()) {
  <div class="error">{{ store.fetchUser.error() }}</div>
} @else if (store.fetchUser.isSuccess()) {
  <div class="success">User loaded successfully!</div>
}

<!-- Reactive user data -->
@if (store.user(); as user) {
  <div>Welcome, {{ user.name }}!</div>
}
```

## 🔄 Chainable API

Actions return handlers that can be chained for component-specific logic:

```typescript
this.store.fetchUser.run('123')
  .onLoading((userId) => console.log('Loading user:', userId))
  .onSuccess((user, userId) => {
    console.log('User loaded:', user);
    this.analytics.track('user_loaded', { userId });
  })
  .onError((error, userId) => {
    console.error('Failed to load user:', error);
    this.analytics.track('user_load_failed', { userId, error });
  })
  .finally(() => {
    console.log('User fetch attempt completed');
  });
```

## ⚠️ Important Notes

### ForkJoin Error Behavior

With `createSignalForkJoinAction`, if **any** HTTP request fails, the **entire operation fails**:

```typescript
// ❌ If posts request fails, you get NO data (even if user request succeeded)
getUserData.run(request)
  .onSuccess(({ user, posts }) => {
    // Only called if BOTH requests succeed
  })
  .onError((error) => {
    // Called if ANY request fails
  });
```

### Handling Partial Failures

If you need partial results, handle errors within individual observables:

```typescript
getUserData = createSignalForkJoinAction(
  (request: BasicQuery) => ({
    user: this.userService.getUser(request).pipe(
      catchError(() => of(null)) // Return null instead of failing
    ),
    posts: this.postService.getPosts(request).pipe(
      catchError(() => of([])) // Return empty array instead of failing
    )
  }),
  {
    onSuccess: (result) => {
      if (result.user) this.user.set(result.user);
      if (result.posts.length) this.posts.set(result.posts);
    }
  }
);
```

## 📝 Best Practices

### ✅ Do

- Use store-level `onSuccess`/`onError` for state updates
- Use component-level `.onSuccess()` for navigation/UI logic
- Add debouncing for user input (search, filters, auto-save)
- Use descriptive generic types: `createSignalAction<[UserId], User>`
- Keep HTTP logic in services, state management in stores

### ❌ Don't

- Mix store state updates in components
- Forget that forkJoin is "all or nothing"
- Add `take(1)` to HTTP observables (they auto-complete)
- Use without TypeScript generics (you'll lose type safety)
- Create actions inside components (create them in stores/services)

## 🔧 Configuration

### HTTP Tracking Integration

The library integrates with your existing `GlobalHttpTracker`:

```typescript
// HTTP tracking is enabled by default
fetchUser = createSignalAction(getUserFn, {
  track: false // Disable tracking for this specific action
});
```

### Debouncing Configuration

```typescript
// Different debounce times for different use cases
searchAction = createSignalAction(searchFn, { debounceMs: 300 });     // Search
filterAction = createSignalAction(filterFn, { debounceMs: 500 });     // Filters  
autoSaveAction = createSignalAction(saveFn, { debounceMs: 1000 });    // Auto-save
```
