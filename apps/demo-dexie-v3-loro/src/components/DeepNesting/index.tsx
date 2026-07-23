/**
 * Deep Nesting Demo - 5-Level Component Hierarchy
 *
 * Demonstrates how React.Context (EventBus) enables:
 * 1. Events from Level 5 to bubble UP to Level 1
 * 2. State changes from Level 1 to propagate DOWN to Level 5
 *
 * Without Context, this would require passing callbacks through all 5 levels.
 *
 * Component Tree:
 *   Level1_Dashboard
 *     └── Level2_Section
 *           └── Level3_Panel
 *                 └── Level4_Card
 *                       └── Level5_Controls
 */

export { Level1_Dashboard } from "./Level1_Dashboard";
export { Level2_Section } from "./Level2_Section";
export { Level3_Panel } from "./Level3_Panel";
export { Level4_Card } from "./Level4_Card";
export { Level5_Controls } from "./Level5_Controls";
