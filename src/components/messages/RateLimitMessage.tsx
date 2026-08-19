import React from 'react'
import { Text } from 'src/ink.js'
import { MessageResponse } from '../MessageResponse.js'

export function getUpsellMessage(): null {
  return null
}

type RateLimitMessageProps = {
  text: string
  onOpenRateLimitOptions?: () => void
}

export function RateLimitMessage({
  text,
}: RateLimitMessageProps): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text color="error">{text}</Text>
    </MessageResponse>
  )
}
