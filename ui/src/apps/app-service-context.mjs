import { MOSS_HOME } from '../moss-home.mjs';
import { createAppServiceStorage } from './app-service-storage.mjs';
import { createLegacyAppServiceUpgrade } from './legacy-app-service-upgrade.mjs';

export const appServiceStorage = createAppServiceStorage({ mossHome: MOSS_HOME });
export const legacyUpgrade = createLegacyAppServiceUpgrade({ mossHome: MOSS_HOME, storage: appServiceStorage });
