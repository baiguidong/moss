import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show plan usage limits',
  isEnabled: () => false,
  isHidden: true,
  load: () => import('./usage.js'),
} satisfies Command
