import { signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiError } from './api-client';

/**
 * What a screen is doing: loading, failed, or showing data.
 *
 * A single field rather than separate `loading` and `error` booleans, because
 * those permit states that make no sense — loading *and* failed — and every
 * template then has to guard against combinations that never occur.
 */
export type LoadState = 'loading' | 'error' | 'ready';

export interface Loader<T> {
  readonly state: () => LoadState;
  readonly data: () => T;
  /** Why it failed, for a message the reader can act on. */
  readonly error: () => string | null;
  load(source: Observable<T>): void;
  /** Update in place after a write, without a round trip. */
  set(value: T): void;
}

/**
 * Drive a screen from one request.
 *
 * `load` takes an Observable, which is the whole difference from the mock
 * version this replaced — `state` and `data` are unchanged, so the templates
 * built against the mock did not have to move.
 *
 * Subscriptions are not tied to a component's lifecycle here. That is
 * deliberate: these are one-shot HTTP calls, they complete on their own, and
 * a late response only writes to signals nobody is reading. A superseded
 * request is discarded by the generation check below, which is the case that
 * would actually show a wrong answer.
 */
export function createLoader<T>(initial: T): Loader<T> {
  const state = signal<LoadState>('loading');
  const data = signal<T>(initial);
  const error = signal<string | null>(null);

  // Guards against an out-of-order response: type in a filter twice quickly
  // and the first request can land second, showing results for a query the
  // user has already changed.
  let generation = 0;

  function load(source: Observable<T>) {
    const mine = ++generation;
    state.set('loading');
    error.set(null);

    source.subscribe({
      next: (value) => {
        if (mine !== generation) return;
        data.set(value);
        state.set('ready');
      },
      error: (err: unknown) => {
        if (mine !== generation) return;
        error.set(err instanceof ApiError ? err.message : 'Something went wrong.');
        state.set('error');
      },
    });
  }

  function set(value: T) {
    // Also claims the current generation, so an in-flight reload cannot
    // overwrite a local edit that has already been applied.
    generation++;
    data.set(value);
    state.set('ready');
  }

  return {
    state: state.asReadonly(),
    data: data.asReadonly(),
    error: error.asReadonly(),
    load,
    set,
  };
}
