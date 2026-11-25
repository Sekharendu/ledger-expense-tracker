import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshLoop } from './refresh.ts';

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  return {
    set(callback: () => void, delay: number) { const id = ++nextId; tasks.set(id, { at: now + delay, callback }); return id; },
    clear(id: unknown) { tasks.delete(id as number); },
    advance(delay: number) {
      now += delay;
      for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.callback(); }
    },
    pending: () => tasks.size,
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('saved-state refresh starts on foreground, pauses hidden and immediately resumes', async () => {
  const clock = fakeClock(); let reads = 0;
  const loop = createRefreshLoop(async () => { reads++; }, 30_000, clock);
  clock.advance(90_000); assert.equal(reads, 0);
  loop.setActive(true); await settle(); assert.equal(reads, 1);
  clock.advance(29_999); assert.equal(reads, 1);
  clock.advance(1); await settle(); assert.equal(reads, 2);
  loop.setActive(false); assert.equal(clock.pending(), 0);
  clock.advance(120_000); assert.equal(reads, 2);
  loop.setActive(true); await settle(); assert.equal(reads, 3);
  loop.stop();
});

test('slow requests and repeated focus events never overlap reads', async () => {
  const clock = fakeClock(); let reads = 0; let finish: () => void = () => {};
  const loop = createRefreshLoop(() => { reads++; return new Promise<void>(resolve => { finish = resolve; }); }, 30_000, clock);
  loop.setActive(true);
  await loop.refresh(); await loop.refresh();
  clock.advance(300_000); assert.equal(reads, 1); assert.equal(clock.pending(), 0);
  finish(); await settle(); assert.equal(clock.pending(), 1);
  clock.advance(30_000); assert.equal(reads, 2);
  loop.stop(); finish(); await settle(); assert.equal(clock.pending(), 0);
});

test('unmount/account cleanup cannot restart timers after an in-flight read settles', async () => {
  const clock = fakeClock(); let oldReads = 0; let finish: () => void = () => {};
  const old = createRefreshLoop(() => { oldReads++; return new Promise<void>(resolve => { finish = resolve; }); }, 30_000, clock);
  old.setActive(true); old.stop(); finish(); await settle();
  old.setActive(true); await old.refresh(); clock.advance(90_000);
  assert.equal(oldReads, 1); assert.equal(clock.pending(), 0);
  let newReads = 0;
  const replacement = createRefreshLoop(async () => { newReads++; }, 30_000, clock);
  replacement.setActive(true); await settle(); clock.advance(30_000); await settle();
  assert.equal(newReads, 2); assert.equal(oldReads, 1);
  replacement.stop(); assert.equal(clock.pending(), 0);
});

test('a failed read retries on the next active interval without a retry storm', async () => {
  const clock = fakeClock(); let reads = 0;
  const loop = createRefreshLoop(async () => { reads++; throw new Error('offline'); }, 30_000, clock);
  loop.setActive(true); await settle(); assert.equal(reads, 1); assert.equal(clock.pending(), 1);
  clock.advance(30_000); await settle(); assert.equal(reads, 2); assert.equal(clock.pending(), 1);
  loop.setActive(false); clock.advance(300_000); assert.equal(reads, 2);
  loop.stop();
});
