import { describe, expect, it, vi } from 'vitest';
import { publish, subscribe, type ServerEvent } from './events';

const event: ServerEvent = { kind: 'map-deleted', mapId: 'abc123abc123' };

describe('events', () => {
  it('delivers to every subscriber until unsubscribed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribe(a);
    const unsubB = subscribe(b);
    publish(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
    unsubA();
    publish(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    unsubB();
  });

  it('a throwing subscriber does not break the others', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const unsubBad = subscribe(bad);
    const unsubGood = subscribe(good);
    publish(event);
    expect(good).toHaveBeenCalledWith(event);
    unsubBad();
    unsubGood();
    errSpy.mockRestore();
  });
});
