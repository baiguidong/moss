import React from 'react'
import { Text } from '../../ink.js'

export const call = async function (): Promise<React.ReactNode> {
  return <Text>Chrome integration is not supported in this build.</Text>
}
