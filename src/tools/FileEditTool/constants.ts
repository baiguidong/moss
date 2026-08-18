// In its own file to avoid circular dependencies
import { getMossConfigHomeDir } from '../../utils/envUtils.js'

export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .moss/ folder
export const MOSS_FOLDER_PERMISSION_PATTERN = '/.moss/**'

// Permission pattern for granting session-level access to the default Moss config folder
export const GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN = '~/.moss/**'

export function getGlobalMossFolderPermissionPattern(): string {
  if (!process.env.MOSS_CONFIG_DIR) {
    return GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN
  }
  const normalized = getMossConfigHomeDir().replaceAll('\\', '/').replace(
    /\/+$/,
    '',
  )
  return `${normalized}/**`
}

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
