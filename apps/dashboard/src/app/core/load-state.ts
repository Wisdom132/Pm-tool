import { signal } from '@angular/core';

/**
 * What a screen is doing: loading, failed, or showing data.
 *
 * A single field rather than separate `loading` and `error` booleans, because
 * those permit states that make no sense — loading *and* failed — and every
 * template then has to guard against combinations that never occur.
 *
 * The shape is deliberately what an HTTP call will produce, so swapping the
 * mock timer for a real request touches only where `load` is called.
 */
export type LoadState = 'loading' | 'error' | 'ready';

export function createLoader<T>(initial: T) {
  const state = signal<LoadState>('loading');
  const data = signal<T>(initial);

  /** Mock: resolve after a beat, or fail when asked, so both are reviewable. */
  function load(value: T, { fail = false, delay = 650 } = {}) {
    state.set('loading');
    setTimeout(() => {
      if (fail) {
        state.set('error');
        return;
      }
      data.set(value);
      state.set('ready');
    }, delay);
  }

  return { state, data, load };
}
