import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';

export function MossMark() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Box flexDirection="column"><Text color="clawd_body">█   █</Text><Text color="clawd_body">██ ██</Text><Text color="clawd_body">█ █ █</Text></Box>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
