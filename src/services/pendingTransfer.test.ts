import { describe, it, expect, beforeEach } from 'vitest';
import { parkTransferPlan, takeParkedTransferPlan } from './pendingTransfer';
import type { TransferPlan } from '../types';

const KEY = 'omnicommander.pendingElevatedTransfer';

const plan = { op: 'copy', entries: [{ from: 'C:\\a.txt', to: 'D:\\a.txt' }] } as unknown as TransferPlan;

describe('pendingTransfer', () => {
  beforeEach(() => localStorage.clear());

  it('hands the parked plan back once and clears it', () => {
    parkTransferPlan(plan);
    expect(takeParkedTransferPlan()).toEqual(plan);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(takeParkedTransferPlan()).toBeNull();
  });

  it('writes the versioned envelope', () => {
    parkTransferPlan(plan);
    expect(JSON.parse(localStorage.getItem(KEY) as string).version).toBe(1);
  });

  // The replay must not run a plan a killed process left half-written.
  it('drops a plan that carries no entries', () => {
    localStorage.setItem(KEY, JSON.stringify({ op: 'copy' }));
    expect(takeParkedTransferPlan()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('drops a corrupt value instead of replaying it', () => {
    localStorage.setItem(KEY, '{not json');
    expect(takeParkedTransferPlan()).toBeNull();
  });
});
