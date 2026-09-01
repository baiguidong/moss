import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type React from 'react'
import { FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js'
import { UserPromptMessage } from './UserPromptMessage.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

export function UserForkBoilerplateMessage({
  addMargin,
  param,
}: Props): React.ReactNode {
  const directiveStart = param.text.lastIndexOf(FORK_DIRECTIVE_PREFIX)
  if (directiveStart < 0) return null
  const directive = param.text
    .slice(directiveStart + FORK_DIRECTIVE_PREFIX.length)
    .trim()
  if (!directive) return null
  return (
    <UserPromptMessage
      addMargin={addMargin}
      param={{ ...param, text: directive }}
    />
  )
}
