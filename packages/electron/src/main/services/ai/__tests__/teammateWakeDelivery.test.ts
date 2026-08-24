// @vitest-environment node
/**
 * `onTeammateMessageWhileIdle` used to drop a teammate's wake message on the
 * floor -- no requeue, no notification -- whenever the workspace window was
 * gone, destroyed, or `sendMessageHandler` wasn't wired yet. The main session
 * never resumed and nothing told the user why. These pin all three drop cases
 * to a notification, and pin the working case to the unchanged delivery path.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  announceTeammateWakeDelivery,
  classifyTeammateWakeDelivery,
  type TeammateWakeDeliveryOutcome,
} from '../teammateWakeDelivery';

const announce = async (outcome: TeammateWakeDeliveryOutcome) => {
  const deliver = vi.fn();
  const notifyUndelivered = vi.fn();
  const logDropped = vi.fn();
  await announceTeammateWakeDelivery(outcome, { deliver, notifyUndelivered, logDropped });
  return {
    delivered: deliver.mock.calls.length > 0,
    reason: notifyUndelivered.mock.calls.at(0)?.[0] as string | undefined,
    logSuffix: logDropped.mock.calls.at(0)?.[0] as string | undefined,
  };
};

describe('classifyTeammateWakeDelivery', () => {
  it('classifies a missing window as window_not_found', () => {
    expect(classifyTeammateWakeDelivery(null, true)).toBe('window_not_found');
  });

  it('classifies a destroyed window as window_destroyed', () => {
    const destroyedWindow = { isDestroyed: () => true };
    expect(classifyTeammateWakeDelivery(destroyedWindow, true)).toBe('window_destroyed');
  });

  it('classifies a live window with no sendMessageHandler as handler_absent', () => {
    const liveWindow = { isDestroyed: () => false };
    expect(classifyTeammateWakeDelivery(liveWindow, false)).toBe('handler_absent');
  });

  it('classifies a live window with a handler as delivered', () => {
    const liveWindow = { isDestroyed: () => false };
    expect(classifyTeammateWakeDelivery(liveWindow, true)).toBe('delivered');
  });
});

describe('announceTeammateWakeDelivery', () => {
  it('delivers and fires no notification when the window and handler are both available', async () => {
    const result = await announce('delivered');
    expect(result.delivered).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.logSuffix).toBeUndefined();
  });

  it('notifies instead of delivering when the workspace window was not found', async () => {
    const result = await announce('window_not_found');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/not open/);
    expect(result.logSuffix).toMatch(/not found/);
  });

  it('notifies instead of delivering when the workspace window was destroyed', async () => {
    const result = await announce('window_destroyed');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/closed/);
    expect(result.logSuffix).toMatch(/destroyed/);
  });

  it('notifies instead of delivering when sendMessageHandler is absent', async () => {
    const result = await announce('handler_absent');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/handler/);
    expect(result.logSuffix).toMatch(/sendMessageHandler/);
  });

  it('gives each of the three drop cases a distinguishable reason and log suffix', async () => {
    const notFound = await announce('window_not_found');
    const destroyed = await announce('window_destroyed');
    const absent = await announce('handler_absent');

    const reasons = [notFound.reason, destroyed.reason, absent.reason];
    const logSuffixes = [notFound.logSuffix, destroyed.logSuffix, absent.logSuffix];
    expect(new Set(reasons).size).toBe(3);
    expect(new Set(logSuffixes).size).toBe(3);
  });
});
