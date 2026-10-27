import React from "react";
import { Text } from "../../ink.js";

export function renderToolUseMessage(input: {
  description?: string;
  command?: string;
}) {
  return <Text>Monitor {input.description || input.command || "command"}</Text>;
}
