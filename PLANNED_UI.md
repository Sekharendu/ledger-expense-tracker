# Planned UI work

## Add-expense button spin

The add-expense control is a round `+` button (bottom right on Overview and Inbox, `addButton` in `src/LedgerScreen.tsx`).

Planned: when tapped, the button spins 360° quickly (about 250–300 ms), then the New expense form opens.

Notes for implementing it:
- Use `react-native-reanimated` (check it is installed first with `npx expo install react-native-reanimated`) or the built-in `Animated` API, with the native driver.
- Rotate the `+` icon (or the whole button) from `0deg` to `360deg`, then call `open()` when the animation finishes, or start opening part-way through so it does not feel slow.
- Reset the rotation to `0deg` afterwards so the next tap spins again.
- Respect the system "reduce motion" setting (`AccessibilityInfo.isReduceMotionEnabled`): skip the spin and open the form directly.
- Keep the tap target at least 48×48 and the `accessibilityLabel="Add an expense"`.
