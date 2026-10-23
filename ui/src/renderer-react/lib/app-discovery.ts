import * as React from 'react';
import { getAppDiscovery, getAppKind, getAppToolCapabilities, APP_DISCOVERY_GROUPS } from '../../../../packages/app-sdk/src/discovery.mjs';
import type { AppDiscoveryPreferences, AppDiscoveryPreferenceUpdate } from '@/types';
export { getAppDiscovery, getAppKind, getAppToolCapabilities, APP_DISCOVERY_GROUPS };
export const EMPTY_APP_PREFERENCES: AppDiscoveryPreferences = { sections: { installed: 'app', marketplace: 'app' } };

const PREFERENCE_EVENT = 'moss:app-discovery';

export function useAppDiscoveryPreferences() {
  const [preferences, setPreferences] = React.useState(EMPTY_APP_PREFERENCES);
  React.useEffect(() => {
    let active = true, modified = false;
    void window.agentDesktop.appDiscovery?.({}).then(value => { if (active && !modified) setPreferences(value); }).catch(() => {});
    const receive = (event: Event) => { modified = true; setPreferences((event as CustomEvent<AppDiscoveryPreferences>).detail); };
    window.addEventListener(PREFERENCE_EVENT, receive);
    return () => { active = false; window.removeEventListener(PREFERENCE_EVENT, receive); };
  }, []);
  const update = React.useCallback(async (input: AppDiscoveryPreferenceUpdate) => {
    if (!window.agentDesktop.appDiscovery) return;
    const value = await window.agentDesktop.appDiscovery(input);
    setPreferences(value);
    window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: value }));
  }, []);
  return { preferences, update };
}
