---
name: accessibility-review
description: Review UI for WCAG essentials, keyboard navigation, contrast, and correct ARIA usage. Load before reviewing or building any user-facing interface change.
---

# Accessibility Review

Accessibility is not a feature; it's whether the interface works at all for a real slice of users. Most failures are cheap to prevent and expensive to retrofit.

## The Essentials (WCAG-grounded, judgment applied)

Four questions cover most of WCAG 2.1 AA in practice:

1. **Perceivable** — can content be seen/heard/read by assistive tech? (alt text, contrast, no info-by-color-alone)
2. **Operable** — can everything be done with a keyboard? (focus, tab order, no traps)
3. **Understandable** — are labels, errors, and states explicit? (form labels, error text, predictable behavior)
4. **Robust** — is it real HTML semantics under the styling? (buttons are `<button>`, headings are `<h1-6>`)

## Keyboard Navigation (the fastest audit)

Unplug the mouse. Tab through the changed UI:

- Every interactive element reachable in a **logical order** (DOM order ≈ visual order).
- **Visible focus indicator** at all times — `outline: none` without a replacement is an automatic REVISE.
- `Enter`/`Space` activate; `Escape` closes modals/menus; arrow keys move within composite widgets (tabs, listboxes).
- **No traps**: you can tab *out* of everything. Modals trap intentionally but restore focus to the trigger on close.
- Anything mouse-only (hover-only menus, drag-only reordering) needs a keyboard path.

## Contrast & Visual

- Text contrast ≥ **4.5:1** (normal), ≥ 3:1 (large text ≥18.7px bold / 24px). UI components and focus indicators ≥ 3:1 against adjacents.
- Check BOTH themes — dark mode regressions are the most common contrast failure in SOREN's dashboard.
- Never encode meaning in color alone: status dots get labels/icons; error fields get text, not just red borders.
- Respect zoom: layout must survive 200% browser zoom without loss of content.
- `prefers-reduced-motion`: gate non-essential animation on it.

## ARIA Judgment

**First rule of ARIA: don't.** Native elements ship with keyboard handling and semantics for free.

- `<button>` not `<div onClick>`; `<a href>` for navigation; `<label for>` on every input; `<nav>/<main>/<h1-6>` for structure.
- ARIA is for what HTML can't express: `aria-expanded` on disclosure triggers, `aria-current` for active nav, `aria-live="polite"` for async status updates (agent status changes, toasts), `aria-label` on icon-only buttons.
- Wrong ARIA is worse than none: `role="button"` without keyboard handlers, `aria-hidden` on focusable content, redundant `role="navigation"` on `<nav>`.
- Dynamic content: loading/success/error state changes that are visual-only are invisible to screen readers — announce via live regions.

## Review Checklist

1. Keyboard-only pass completed: reachable, visible focus, logical order, no traps, modals restore focus.
2. Icon-only buttons have `aria-label`; images have `alt` (empty `alt=""` for decorative).
3. Form inputs have programmatic labels; errors are text associated via `aria-describedby`.
4. Contrast spot-checked in light AND dark mode (DevTools contrast checker).
5. Semantics: real buttons/links/headings under the Tailwind classes.
6. Async updates announced or reflected in accessible text, not just color/animation.

## Anti-Patterns

- `div`/`span` click handlers ("we'll add ARIA later" — you're rebuilding `<button>` badly).
- `tabindex` values > 0 — they wreck natural order; use DOM order.
- Placeholder text as the only label — it vanishes on input.
- `outline: none` globally "for aesthetics".
- Auto-focus stealing, or focus lost to `<body>` after a dialog closes.
- ARIA sprinkled on to silence an audit tool without testing with a keyboard.
