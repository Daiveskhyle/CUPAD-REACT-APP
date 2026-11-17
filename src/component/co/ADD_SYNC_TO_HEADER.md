# Add Sync Button to Your Existing Header

**Do not replace** your `Header.tsx` or `BottomNavbar.tsx`.
Only add the sync control to the right side of your current header.

## 1. Copy this file into your project

```
src/component/co/HeaderSyncButton.tsx
```

## 2. In your existing `Header.tsx`

```tsx
import HeaderSyncButton from "./HeaderSyncButton";

// Inside your header right-side row (next to profile / menu icons):
<HeaderSyncButton color={colors.textMuted /* or your icon color */} />
```

### Example

```tsx
<View style={styles.rightActions}>
  {/* your existing buttons */}
  <HeaderSyncButton color={isDark ? "#94A3B8" : "#64748B"} />
  <Pressable onPress={openProfile}>
    <Ionicons name="person-circle-outline" size={24} color={iconColor} />
  </Pressable>
</View>
```

## 3. CoScreenWrapper

Use a **pass-through** wrapper (children only) so your Header + BottomNavbar
from your original files keep working:

```tsx
export default function CoScreenWrapper({ children }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
```

Or keep your original CoScreenWrapper that already renders `<Header />` and
`<BottomNavbar />` — just ensure Header includes `HeaderSyncButton`.

## Restore original files from git (if overwritten)

```bash
git checkout HEAD -- src/component/co/Header.tsx
git checkout HEAD -- src/component/co/BottomNavbar.tsx
git checkout HEAD -- src/component/co/CoScreenWrapper.tsx
```

Then add the one-line `HeaderSyncButton` import + usage as above.
