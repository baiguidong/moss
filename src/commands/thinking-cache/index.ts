import type { Command } from '../../types/command.js'

export default {
  type: 'local',
  name: 'thinking-cache',
  description: 'Clear cached thinking parameter compatibility with /thinking-cache clear',
  supportsNonInteractive: true,
  load: () => import('./thinking-cache.js'),
} satisfies Command
