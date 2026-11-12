import React from 'react'
import { Box, Text } from 'src/ink.js'

const WELCOME_V2_WIDTH = 58
const MOSS_GREEN = 'green_FOR_SUBAGENTS_ONLY'

// Keep the welcome mark in plain block characters so it renders consistently
// in regular terminals, Apple Terminal, and terminals without truecolor.
const MOSS_WORDMARK = [
  '███╗   ███╗ ██████╗ ███████╗███████╗',
  '████╗ ████║██╔═══██╗██╔════╝██╔════╝',
  '██╔████╔██║██║   ██║███████╗███████╗',
  '██║╚██╔╝██║██║   ██║╚════██║╚════██║',
  '██║ ╚═╝ ██║╚██████╔╝███████║███████║',
  '╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚══════╝',
]

export function WelcomeV2(): React.ReactNode {
  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column">
      <Text>
        <Text color={MOSS_GREEN}>欢迎使用 Moss </Text>
        <Text dimColor>v{MACRO.VERSION}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {MOSS_WORDMARK.map(line => (
          <Text key={line} color={MOSS_GREEN} bold>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
