import { useEffect, useState } from 'react';
import { currentPlatformInfo, watchPlatformInfo, PlatformInfo } from '../services/platform';

/**
 * The platform answer in force, re-rendering when the server sends a new one.
 *
 * App.tsx requests it once at start-up; this hook only follows that answer, so a
 * view never fetches it twice. The first paint uses the user-agent guess, which
 * is already right about the operating system, and the server's capabilities
 * replace it as soon as they arrive.
 */
export function usePlatformInfo(): PlatformInfo {
  const [info, setInfo] = useState(currentPlatformInfo);

  useEffect(() => watchPlatformInfo(setInfo), []);

  return info;
}
