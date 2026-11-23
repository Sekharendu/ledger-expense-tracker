---
name: Ledger
description: A calm personal account statement for everyday bookkeeping.
colors:
  background: "#FDFBD4"
  surface: "#F3EDCC"
  ink: "#38240D"
  muted: "#713600"
  outline: "#D9C8A7"
  primary: "#C05800"
  primaryText: "#713600"
  primaryPressed: "#713600"
  onPrimary: "#FFFFFF"
  primaryContainer: "#F5E1BD"
  onPrimaryContainer: "#713600"
  onDark: "#FDFBD4"
  mutedOnDark: "#DDD0AD"
  outlineOnDark: "#604322"
  error: "#963E32"
  errorContainer: "#F5E6E1"
typography:
  display:
    fontSize: "44px"
    lineHeight: "54px"
    fontWeight: 500
    letterSpacing: "-1.2px"
  headline:
    fontSize: "30px"
    lineHeight: "38px"
    fontWeight: 500
    letterSpacing: "-0.6px"
  title:
    fontSize: "18px"
    lineHeight: "26px"
    fontWeight: 600
    letterSpacing: "-0.2px"
  body:
    fontSize: "14px"
    lineHeight: "22px"
  label:
    fontSize: "12px"
    lineHeight: "18px"
    fontWeight: 500
rounded:
  track: "2px"
  tile: "4px"
  status: "8px"
  receipt: "10px"
  control: "12px"
  panel: "16px"
  round-control: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  row-gap: "12px"
  md: "16px"
  lg: "24px"
  section: "28px"
  columns: "36px"
  expanded-inset: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.onPrimary}"
    rounded: "{rounded.control}"
    padding: "16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "16px"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "16px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "13px 16px"
  chip-selected:
    backgroundColor: "{colors.primaryContainer}"
    textColor: "{colors.onPrimaryContainer}"
    rounded: "{rounded.control}"
    padding: "13px 16px"
  navigation:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.mutedOnDark}"
    padding: "12px 8px"
  statement:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.onDark}"
    rounded: "{rounded.panel}"
    padding: "14px 24px 20px"
  record:
    textColor: "{colors.ink}"
    padding: "18px 0"
---

# Design System: Ledger

## Overview

**Creative North Star: "Personal account statement"**

Ledger uses the calm precision of a personal account statement: cream working space, dark chocolate anchors, and caramel actions. The approved direction is classy and minimalist, with an approximate 60% cream, 30% dark chocolate, and 10% caramel visual balance.

Native system sans typography, aligned financial figures, open sections, and restrained rounded controls keep bookkeeping readable. This is an Android-first React Native system; code is the design authority.

**Key Characteristics:**

- Cream workspace and dark chocolate statement/navigation anchors.
- Caramel for action, selection, refunds, and category bars.
- Native system sans with tabular financial figures.
- Flat surfaces, precise dividers, and generous working margins.

## Colors

The frontmatter is normative, extracted from `src/theme.ts`. Token names retain the source spelling.

### Primary

Caramel (`primary`) fills primary actions and selected navigation and colors category bars. Medium brown (`primaryText`) gives small action text, refunds, and review emphasis sufficient contrast. `primaryPressed` is the add action's pressed fill. `primaryContainer` and `onPrimaryContainer` form the quieter selection treatment; `onPrimary` labels solid caramel controls.

### Neutral

Cream (`background`) is the workspace. `surface` supports inputs, secondary controls, and pressed rows. Dark chocolate (`ink`) anchors text, statements, and navigation. `muted` supports secondary copy; `outline` separates rows and surfaces. `onDark`, `mutedOnDark`, and `outlineOnDark` provide the corresponding dark-surface hierarchy.

### Status

`error` and `errorContainer` identify validation, overdue text, destructive actions, and errors. Status words remain visible alongside semantic color.

**The Caramel Rule.** Reserve caramel fills for action and selection; use medium brown for small text and meaningful financial emphasis; keep category visualization monochrome.

## Typography

React Native's default system sans is intentional. No custom font family is loaded or prescribed. Frontmatter pixel strings serialize React Native logical style values for portable tooling; native dimensions use density-independent units and text follows platform font scaling.

Display serves the net spending amount; headline serves screen and form titles and outstanding totals. Title serves section and empty-state headings. Body serves descriptions, controls, and records; label serves navigation, metadata, and supporting copy. Body weights are inherited unless a component explicitly applies medium or semibold.

Financial amounts use `fontVariant: ['tabular-nums']`. The net spending amount permits one-line fitting. The wordmark is a local exception (27/34, weight 600, tracking −0.8); summary tiles use 25/34 medium and the amount field uses 26/34. These exceptions are component treatments, not new global type roles.

## Layout

Respect device safe-area insets. Compact content has 24 dp horizontal margins and 28 dp top padding. Expanded content uses 40 dp horizontal and 36 dp top padding. The content container is centered with a 1080 dp maximum width; the form has a 620 dp maximum width and 24 dp padding.

At window width 760 dp or greater, bottom navigation becomes a 112 dp left rail and detail sections form two equal columns with a 36 dp gap. Below that width, navigation stays below the workspace and details stay in a vertical flow.

At effective width `width / fontScale < 350`, summary tiles and record rows stack. Record figures align beneath the description with a 48 dp leading inset. Chips wrap; headings, metadata, and amounts can shrink or wrap where implemented.

The add action is positioned above the measured compact navigation height plus 14 dp, or 24 dp above the expanded workspace bottom. Scroll content reserves 112 dp at its end. Standard icon controls have 48 dp minimum targets; chips have a 48 dp minimum height. Navigation items have at least 60 dp height, or 72 dp in the rail.

## Elevation & Depth

The implementation is flat: tonal blocks and single-unit dividers establish separation. There are no authored shadow or elevation tokens. The statement's dark chocolate fill provides its visual weight. The record editor is a full-screen native modal with `animationType="none"`; no transition duration or easing scale is defined.

## Shapes

Panels, the add action, selected navigation capsules, and empty-state marks use the panel radius. Inputs, buttons, and filter chips share the control radius. Receipt containers use the receipt radius; progress tracks use the track radius. The small code-drawn brand mark is a local 7 dp exception.

## Components

- **Buttons:** shared primary, outlined neutral secondary, and outlined destructive variants. Standard buttons have a 52 dp minimum height, 16 dp padding, and body text at weight 600. Pressed primary controls use medium brown; pressed secondary controls use the neutral surface. Disabled controls apply opacity 0.4. Settings and the Gmail connection interface receive this shared button and style vocabulary.
- **Add action:** caramel with a plus icon, 56 dp minimum height, 20 dp horizontal and 14 dp vertical padding. Pressing changes its fill to `primaryPressed`.
- **Inputs:** neutral surface, one-unit outline, control corners, 56 dp minimum height, pale caramel text selection, and visible field labels.
- **Chips:** outlined neutral by default; selected chips use the caramel container, caramel border, and semibold container text. Selection is also exposed through accessibility state.
- **Navigation:** dark chocolate with muted labels and icons. Selection adds an caramel icon capsule and a brighter semibold label. Pressed navigation uses `outlineOnDark`.
- **Statement:** dark chocolate panel with month controls, dominant tabular amount, and a divider above its explanatory footer.
- **Records:** open rows with a bottom divider, receipt icon container, descriptive text, aligned amount, and written status. Pressing uses `surface`; compact effective widths stack the figures.
- **Icons:** authored SVG on a 24-unit grid, stroke width 1.6, round caps and joins. Contextual display sizes vary; retain this stroke vocabulary.
- **Feedback:** errors use an error-colored message on the error container with control corners and 16 dp padding. Empty states combine an existing receipt icon, a title, and explanatory text.

The sidecar contains self-contained HTML/CSS translations for inspection only. Their logical dimensions mirror native styles; they are not a runtime implementation or proof of native rendering. Native controls retain platform interaction behavior; no bespoke hover or focus style is established by the source.

## Do's and Don'ts

### Do

- Do use the shared theme for new screens and shared settings controls.
- Do keep spending and outstanding obligations visually distinct.
- Do preserve native font scaling, safe areas, and wrapping or stacking behavior.
- Do use the existing 24-unit stroke icon vocabulary.

### Don't

- Don't introduce decorative raster artwork into the working interface.
- Don't add category rainbow colors, ornamental shadows, or display fonts.
- Don't use color alone to communicate payment or review status.
- Don't describe web preview specimens as native Android verification.


The supplied Chocolate truffle swatches are cream `#FDFBD4` (about 60%), dark chocolate `#38240D` (about 30%), and caramel `#C05800` (about 10%). Medium brown `#713600` supports secondary text and pressed actions. Derived surface/border shades stay within this family. White button text is retained for contrast: white on caramel exceeds 4.5:1, while cream on caramel does not. Small action text uses `primaryText`, not the caramel fill token. Error colors remain semantic.
