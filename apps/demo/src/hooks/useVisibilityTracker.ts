import React from "react";

type VisibilityTrackerOptions<TId extends string> = {
  /** Called when an element becomes visible */
  onVisible: (id: TId) => void;
  /** IDs to skip observing (already processed) */
  skipIds?: Set<string>;
  /** IntersectionObserver threshold (default: 1) */
  threshold?: number;
};

/**
 * Tracks element visibility using IntersectionObserver.
 * Returns a ref callback to register elements by ID.
 */
export const useVisibilityTracker = <TId extends string>({
  onVisible,
  skipIds,
  threshold = 1,
}: VisibilityTrackerOptions<TId>) => {
  const elementRefs = React.useRef<Map<TId, HTMLElement>>(new Map());
  const observer = React.useRef<IntersectionObserver | null>(null);

  // Reverse lookup: element -> id
  const findIdByElement = React.useCallback((element: Element): TId | undefined => {
    for (const [id, el] of elementRefs.current) {
      if (el === element) return id;
    }
    return undefined;
  }, []);

  // Observer callback
  const observerCallback = React.useCallback(
    (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const id = findIdByElement(entry.target);
        if (id) {
          onVisible(id);
        }

        observer.current?.unobserve(entry.target);
      });
    },
    [onVisible, findIdByElement],
  );

  // Create observer
  React.useEffect(() => {
    observer.current = new IntersectionObserver(observerCallback, { threshold });
    return () => observer.current?.disconnect();
  }, [observerCallback, threshold]);

  // Ref callback for registering elements
  const setElementRef = React.useCallback(
    (id: TId, element: HTMLElement | null) => {
      if (element) {
        elementRefs.current.set(id, element);
        if (!skipIds?.has(id)) {
          observer.current?.observe(element);
        }
      } else {
        elementRefs.current.delete(id);
      }
    },
    [skipIds],
  );

  // Get element by ID (for external use like focus handling)
  const getElement = React.useCallback((id: TId) => elementRefs.current.get(id), []);

  return { setElementRef, getElement };
};
