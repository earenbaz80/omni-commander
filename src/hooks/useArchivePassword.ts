import { useCallback, useRef, useState } from 'react';

export interface ArchivePasswordRequest {
  fileName: string;
  invalid: boolean;
}

/**
 * A password request is a promise the panel awaits, so the modal has to settle
 * exactly once: with what the user typed, or with null when they cancel. The
 * promise lives in a ref because it is not render state -- what is rendered is
 * only the request being asked about.
 */
export function useArchivePassword() {
  const pendingPassword = useRef<{ resolve: (value: string | null) => void } | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<ArchivePasswordRequest | null>(null);

  const settlePassword = useCallback((value: string | null) => {
    const pending = pendingPassword.current;
    pendingPassword.current = null;
    setPasswordRequest(null);
    pending?.resolve(value);
  }, []);

  const requestArchivePassword = useCallback(
    (fileName: string, invalid?: boolean): Promise<string | null> =>
      new Promise((resolve) => {
        // A second archive opened while the modal is up cancels the first ask,
        // so no promise is left waiting on a prompt that is no longer shown.
        pendingPassword.current?.resolve(null);
        pendingPassword.current = { resolve };
        setPasswordRequest({ fileName, invalid: Boolean(invalid) });
      }),
    [],
  );

  return { passwordRequest, settlePassword, requestArchivePassword };
}
