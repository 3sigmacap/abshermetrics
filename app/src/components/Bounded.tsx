import { useWindowDimensions, View, type ViewProps } from 'react-native';

import { MAX_W } from '@/theme';

/**
 * Caps content width and centers it on large screens (iPad), in BOTH orientations. On
 * phones (narrower than MAX_W) it's a no-op, so phone layout is unchanged. Wrap a
 * screen's scroll content in this so the app reads as an intentional tablet layout
 * instead of stretched phone UI.
 *
 * The cap is adaptive: a readable column in portrait (~MAX_W) that widens in landscape
 * so the screen doesn't look sparse, but never spans an uncomfortably wide line length.
 * Works because a ScrollView's contentContainer lays children out stretched by default;
 * alignSelf:'center' + maxWidth overrides that to a centered, capped column.
 */
export default function Bounded({ style, ...props }: ViewProps) {
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(1100, Math.max(MAX_W, Math.round(width * 0.82)));
  return <View {...props} style={[{ width: '100%', maxWidth, alignSelf: 'center' }, style]} />;
}
