import { useLayoutEffect, useRef } from 'react';

/**
 * Remembers when the current question appeared on this device, so each client measures
 * its own answer time independent of network latency.
 */
export function useQuestionClock(questionId: string | undefined) {
  const shownAt = useRef(performance.now());
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, [questionId]);
  return () => Math.round(performance.now() - shownAt.current);
}
