import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Returns true when the user has indicated a preference for reduced
 * motion. Treats native platforms as "no preference" — adopting the
 * real native AccessibilityInfo.isReduceMotionEnabled() check is a
 * future enhancement once we have a Reanimated-style platform-wide
 * motion system in place.
 *
 * On web we listen to the prefers-reduced-motion media query and
 * update reactively if the user toggles it.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;

    setReduced(media.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);

    // Older Safari uses addListener / removeListener
    if (media.addEventListener) {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return reduced;
}
