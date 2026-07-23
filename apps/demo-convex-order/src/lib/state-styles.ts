/**
 * Shared State Style Mappings
 *
 * Centralized styling for OrderState variants.
 * Used across components for consistent state visualization.
 *
 * Design: Uses a typed Record for O(1) lookups. Match is overkill here since
 * all cases map to the same structure - just use the type system.
 */

import type { OrderState } from "@/machines/order";

// ============================================================================
// Types
// ============================================================================

export interface StateStyle {
  readonly bg: string;
  readonly text: string;
  readonly border: string;
  readonly glow: string;
  readonly ring: string;
}

export type StateTag = OrderState["_tag"];

// ============================================================================
// Style Definitions (Single Source of Truth)
// ============================================================================

const styles: Record<StateTag, StateStyle> = {
  Cart: {
    bg: "bg-gray-500",
    text: "text-gray-300",
    border: "border-gray-500",
    glow: "rgba(156,163,175,0.5)",
    ring: "ring-gray-500",
  },
  Checkout: {
    bg: "bg-blue-500",
    text: "text-blue-300",
    border: "border-blue-500",
    glow: "rgba(59,130,246,0.5)",
    ring: "ring-blue-500",
  },
  Processing: {
    bg: "bg-yellow-500",
    text: "text-yellow-300",
    border: "border-yellow-500",
    glow: "rgba(234,179,8,0.5)",
    ring: "ring-yellow-500",
  },
  Shipped: {
    bg: "bg-purple-500",
    text: "text-purple-300",
    border: "border-purple-500",
    glow: "rgba(168,85,247,0.5)",
    ring: "ring-purple-500",
  },
  Delivered: {
    bg: "bg-green-500",
    text: "text-green-300",
    border: "border-green-500",
    glow: "rgba(34,197,94,0.5)",
    ring: "ring-green-500",
  },
  Cancelled: {
    bg: "bg-red-500",
    text: "text-red-300",
    border: "border-red-500",
    glow: "rgba(239,68,68,0.5)",
    ring: "ring-red-500",
  },
};

// ============================================================================
// Accessors (Direct Record access - type-safe via StateTag constraint)
// ============================================================================

/** Get full style object for a state tag */
export const getStateStyle = (tag: StateTag): StateStyle => styles[tag];

/** Get background color class */
export const getStateBg = (tag: StateTag): string => styles[tag].bg;

/** Get text color class */
export const getStateText = (tag: StateTag): string => styles[tag].text;

/** Get border color class */
export const getStateBorder = (tag: StateTag): string => styles[tag].border;

/** Get glow color for drop-shadow effects */
export const getStateGlow = (tag: StateTag): string => styles[tag].glow;

// ============================================================================
// Composite Style Helpers
// ============================================================================

/** Get badge classes for state display */
export const getStateBadgeClasses = (tag: StateTag): string => {
  const s = styles[tag];
  return `${s.bg} ${s.text}`;
};

/** Get card accent classes */
export const getStateCardClasses = (tag: StateTag): string => {
  const s = styles[tag];
  return `${s.border} ${s.ring}`;
};
