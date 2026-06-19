import { View, type ViewProps } from 'react-native';

import { MAX_W } from '@/theme';

/**
 * Caps content width and centers it on large screens (iPad). On phones (narrower than
 * MAX_W) it's a no-op, so phone layout is unchanged. Wrap a screen's scroll content in
 * this so the app reads as an intentional tablet layout instead of stretched phone UI.
 *
 * Works because a ScrollView's contentContainer lays children out stretched by default;
 * alignSelf:'center' + maxWidth on this View overrides that to a centered, capped column.
 */
export default function Bounded({ style, ...props }: ViewProps) {
  return <View {...props} style={[{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }, style]} />;
}
