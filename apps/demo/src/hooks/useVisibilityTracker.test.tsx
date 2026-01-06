import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisibilityTracker } from "./useVisibilityTracker";

// Mock IntersectionObserver
let mockObserverInstance: MockIntersectionObserver | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: readonly number[] = [];
  callback: IntersectionObserverCallback;
  elements: Set<Element> = new Set();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    mockObserverInstance = this;
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  // Test helper: simulate elements becoming visible
  simulateIntersection(entries: Partial<IntersectionObserverEntry>[]) {
    this.callback(
      entries.map((entry) => ({
        isIntersecting: true,
        target: document.createElement("div"),
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRatio: 1,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
        ...entry,
      })) as IntersectionObserverEntry[],
      this,
    );
  }
}

beforeEach(() => {
  mockObserverInstance = null;
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

describe("useVisibilityTracker", () => {
  it("calls onVisible when element becomes visible", () => {
    const onVisible = vi.fn();
    const { result } = renderHook(() => useVisibilityTracker({ onVisible }));

    // Register an element
    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    // Simulate intersection
    act(() => {
      mockObserverInstance?.simulateIntersection([
        { isIntersecting: true, target: element },
      ]);
    });

    expect(onVisible).toHaveBeenCalledWith("msg-1");
  });

  it("does not call onVisible for non-intersecting elements", () => {
    const onVisible = vi.fn();
    const { result } = renderHook(() => useVisibilityTracker({ onVisible }));

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    act(() => {
      mockObserverInstance?.simulateIntersection([
        { isIntersecting: false, target: element },
      ]);
    });

    expect(onVisible).not.toHaveBeenCalled();
  });

  it("skips observing elements in skipIds", () => {
    const onVisible = vi.fn();
    const skipIds = new Set(["msg-1"]);
    const { result } = renderHook(() =>
      useVisibilityTracker({ onVisible, skipIds }),
    );

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    // Element should not be observed
    expect(mockObserverInstance?.elements.has(element)).toBe(false);
  });

  it("observes elements not in skipIds", () => {
    const onVisible = vi.fn();
    const skipIds = new Set(["msg-1"]);
    const { result } = renderHook(() =>
      useVisibilityTracker({ onVisible, skipIds }),
    );

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-2", element);
    });

    expect(mockObserverInstance?.elements.has(element)).toBe(true);
  });

  it("unobserves element after it becomes visible", () => {
    const onVisible = vi.fn();
    const { result } = renderHook(() => useVisibilityTracker({ onVisible }));

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    expect(mockObserverInstance?.elements.has(element)).toBe(true);

    act(() => {
      mockObserverInstance?.simulateIntersection([
        { isIntersecting: true, target: element },
      ]);
    });

    expect(mockObserverInstance?.elements.has(element)).toBe(false);
  });

  it("removes element from refs when null is passed", () => {
    const onVisible = vi.fn();
    const { result } = renderHook(() => useVisibilityTracker({ onVisible }));

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    expect(result.current.getElement("msg-1")).toBe(element);

    act(() => {
      result.current.setElementRef("msg-1", null);
    });

    expect(result.current.getElement("msg-1")).toBeUndefined();
  });

  it("getElement returns the registered element", () => {
    const onVisible = vi.fn();
    const { result } = renderHook(() => useVisibilityTracker({ onVisible }));

    const element = document.createElement("div");
    act(() => {
      result.current.setElementRef("msg-1", element);
    });

    expect(result.current.getElement("msg-1")).toBe(element);
    expect(result.current.getElement("msg-2")).toBeUndefined();
  });
});
