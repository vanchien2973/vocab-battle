import { useEffect, useRef, useState } from 'react';

/** Local 3-2-1 countdown: `start()` begins it, `onDone` fires after reaching zero. */
export function useCountdown(seconds: number, onDone: () => void) {
  const [value, setValue] = useState<number | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (value === null) return;
    if (value <= 0) {
      setValue(null);
      done.current();
      return;
    }
    const t = setTimeout(() => setValue(value - 1), 1000);
    return () => clearTimeout(t);
  }, [value]);

  return { value, start: () => setValue(seconds) };
}
