/**
 * Shared State Style Mappings
 *
 * Centralized styling for OrderState variants using Effect Match.
 * Used across components for consistent state visualization.
 */

import { Match, pipe } from "effect";
import type { OrderState } from "@/machines/order";

// ============================================================================
// Types
// ============================================================================

export interface StateStyle {
  /** Background color class (e.g., "bg-gray-500") */
  readonly bg: string;
  /** Text color class (e.g., "text-gray-300") */
  readonly text: string;
  /** Border color class (e.g., "border-gray-500") */
  readonly border: string;
  /** Glow/shadow color for effects */
  readonly glow: string;
  /** Ring color for focus states */
  readonly ring: string;
}

export type StateTag = OrderState["_tag"];

// ============================================================================
// Style Definitions
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
// Match-based Accessors
// ============================================================================

/** Get full style object for a state tag */
export const getStateStyle = (tag: StateTag): StateStyle => styles[tag];

/** Get background color class */
export const getStateBg = (tag: StateTag): string =>
  pipe(
    Match.value(tag),
    Match.when("Cart", () => styles.Cart.bg),
    Match.when("Checkout", () => styles.Checkout.bg),
    Match.when("Processing", () => styles.Processing.bg),
    Match.when("Shipped", () => styles.Shipped.bg),
    Match.when("Delivered", () => styles.Delivered.bg),
    Match.when("Cancelled", () => styles.Cancelled.bg),
    Match.exhaustive
  );

/** Get text color class */
export const getStateText = (tag: StateTag): string =>
  pipe(
    Match.value(tag),
    Match.when("Cart", () => styles.Cart.text),
    Match.when("Checkout", () => styles.Checkout.text),
    Match.when("Processing", () => styles.Processing.text),
    Match.when("Shipped", () => styles.Shipped.text),
    Match.when("Delivered", () => styles.Delivered.text),
    Match.when("Cancelled", () => styles.Cancelled.text),
    Match.exhaustive
  );

/** Get border color class */
export const getStateBorder = (tag: StateTag): string =>
  pipe(
    Match.value(tag),
    Match.when("Cart", () => styles.Cart.border),
    Match.when("Checkout", () => styles.Checkout.border),
    Match.when("Processing", () => styles.Processing.border),
    Match.when("Shipped", () => styles.Shipped.border),
    Match.when("Delivered", () => styles.Delivered.border),
    Match.when("Cancelled", () => styles.Cancelled.border),
    Match.exhaustive
  );

/** Get glow color for drop-shadow effects */
export const getStateGlow = (tag: StateTag): string =>
  pipe(
    Match.value(tag),
    Match.when("Cart", () => styles.Cart.glow),
    Match.when("Checkout", () => styles.Checkout.glow),
    Match.when("Processing", () => styles.Processing.glow),
    Match.when("Shipped", () => styles.Shipped.glow),
    Match.when("Delivered", () => styles.Delivered.glow),
    Match.when("Cancelled", () => styles.Cancelled.glow),
    Match.exhaustive
  );

// ============================================================================
// Composite Style Helpers
// ============================================================================

/** Get badge classes for state display */
export const getStateBadgeClasses = (tag: StateTag): string => {
  const style = getStateStyle(tag);
  return `${style.bg} ${style.text}`;
};

/** Get card accent classes */
export const getStateCardClasses = (tag: StateTag): string => {
  const style = getStateStyle(tag);
  return `${style.border} ${style.ring}`;
};
