import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from 'src/ink.js';
import { formatAPIError } from 'src/services/api/errorUtils.js';
import type { SystemAPIErrorMessage as APIErrorMessage } from 'src/types/message.js';
import type { RetryBudgetSnapshot } from '../../services/api/retryBudget.js';
import { useInterval } from 'usehooks-ts';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { MessageResponse } from '../MessageResponse.js';

const MAX_API_ERROR_CHARS = 1000;
type Props = { message: APIErrorMessage & { retryBudget?: RetryBudgetSnapshot }; verbose: boolean };

export function SystemAPIErrorMessage({ message, verbose }: Props) {
  const { retryAttempt, error, retryInMs, maxRetries, retryBudget } = message;
  const hidden = !retryBudget && retryAttempt < 4;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { setElapsed(0); }, [message.uuid]);
  useInterval(() => setElapsed((value: number) => value + 1000), hidden || elapsed >= retryInMs ? null : 1000);
  if (hidden) return null;
  const seconds = Math.max(0, Math.ceil((retryInMs - elapsed) / 1000));
  const formatted = formatAPIError(error);
  const truncated = !verbose && formatted.length > MAX_API_ERROR_CHARS;
  return <MessageResponse><Box flexDirection="column">
    <Text color="error">{truncated ? formatted.slice(0, MAX_API_ERROR_CHARS) + '…' : formatted}</Text>
    {truncated && <CtrlOToExpand />}
    <Text dimColor>Retrying in {seconds}s · attempts {retryAttempt}/{retryBudget?.maxAttempts ?? maxRetries}</Text>
    {retryBudget && <Text dimColor>Retry wait used {(retryBudget.waitedMs / 1000).toFixed(1)}s / {retryBudget.maxWaitMs / 1000}s</Text>}
  </Box></MessageResponse>;
}
