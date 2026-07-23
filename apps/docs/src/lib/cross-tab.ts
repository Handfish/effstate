/**
 * Cross-tab primitives for the demo.
 *
 * - `useIsLeader` elects a single "leader" tab per namespace via localStorage.
 *   The newest tab (and whichever tab is focused) claims leadership; only the
 *   leader writes state. This pairs with `useActorSync`, which saves when
 *   `isLeader` is true and applies external snapshots otherwise.
 * - `useStorageValue` returns the current string at a localStorage key and
 *   updates when another tab writes it (the `storage` event only fires in
 *   OTHER tabs, which is exactly what followers need).
 */

import { useEffect, useRef, useState } from "react";

function makeId(): string {
  // Avoids Date.now()/Math.random() concerns — good enough for tab identity.
  return `tab-${Math.floor(performance.now())}-${(performance.now() % 1) * 1e9}`;
}

export function useIsLeader(namespace: string): boolean {
  const idRef = useRef<string>("");
  if (idRef.current === "") idRef.current = makeId();

  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    const leaderKey = `${namespace}:leader`;
    const id = idRef.current;

    const claim = () => {
      localStorage.setItem(leaderKey, id);
      setIsLeader(true);
    };
    const check = () => setIsLeader(localStorage.getItem(leaderKey) === id);
    const release = () => {
      if (localStorage.getItem(leaderKey) === id) localStorage.removeItem(leaderKey);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === leaderKey) check();
    };
    const onFocus = () => claim();

    // Newest tab wins on mount; reclaim on focus.
    claim();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", release);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", release);
      release();
    };
  }, [namespace]);

  return isLeader;
}

export function useStorageValue(key: string): string | undefined {
  const [value, setValue] = useState<string | undefined>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(key) ?? undefined : undefined,
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValue(e.newValue ?? undefined);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return value;
}

export function readSnapshot(key: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(key) ?? undefined;
}
