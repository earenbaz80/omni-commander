import { useEffect, useRef } from 'react';
import { startTrayBridge, type ConflictDecision } from '../services/trayBridge';
import type { LanguageCode, TransferPlan } from '../types';
import type { TransferQueue } from './useTransferQueue';

/**
 * The tray mirrors the live transfer and turns its menu picks into the same
 * pause/resume/cancel the in-window bar calls, plus a repeat of the last stopped
 * one. The refs keep the queue callbacks current without re-subscribing the menu
 * on every render; restarting on a language change only relabels it.
 */
export function useTrayBridge(lang: LanguageCode, transferQueue: TransferQueue): void {
  const repeatFromTray = useRef<(plan: TransferPlan) => void>(() => {});
  repeatFromTray.current = (plan) => {
    void transferQueue.handleRunCopyList([plan]);
  };
  const answerFromTray = useRef<(jobId: string, decision: ConflictDecision, applyToAll: boolean) => void>(() => {});
  answerFromTray.current = (jobId, decision, applyToAll) =>
    transferQueue.answerConflictFromTray(jobId, decision, applyToAll);

  useEffect(
    () =>
      startTrayBridge(
        lang,
        (plan) => repeatFromTray.current(plan),
        (jobId, decision, applyToAll) => answerFromTray.current(jobId, decision, applyToAll),
      ),
    [lang],
  );
}
