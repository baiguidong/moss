import * as React from 'react'
import { Ansi, Box, Text } from '../../ink.js'
import {
  segmentTextByHighlights,
  type TextHighlight,
} from '../../utils/textHighlighting.js'

type Props = {
  text: string
  highlights: TextHighlight[]
}

type LinePart = {
  text: string
  highlight: TextHighlight | undefined
}

export function HighlightedInput({ text, highlights }: Props): React.ReactNode {
  const lines = React.useMemo(() => {
    const result: LinePart[][] = [[]]

    for (const segment of segmentTextByHighlights(text, highlights)) {
      const parts = segment.text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) result.push([])
        const part = parts[i]!
        if (part.length > 0) {
          result[result.length - 1]!.push({
            text: part,
            highlight: segment.highlight,
          })
        }
      }
    }

    return result
  }, [highlights, text])

  return (
    <Box flexDirection="column">
      {lines.map((lineParts, lineIndex) => (
        <Box key={lineIndex}>
          {lineParts.length === 0 ? (
            <Text> </Text>
          ) : (
            lineParts.map((part, partIndex) => (
              <Text
                key={partIndex}
                color={part.highlight?.color}
                dimColor={part.highlight?.dimColor}
                inverse={part.highlight?.inverse}
              >
                <Ansi>{part.text}</Ansi>
              </Text>
            ))
          )}
        </Box>
      ))}
    </Box>
  )
}
