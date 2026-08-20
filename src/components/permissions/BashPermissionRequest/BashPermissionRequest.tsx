import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/featureFlags.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { getFirstWordPrefix, getSimpleCommandPrefix } from '../../../tools/BashTool/bashPermissions.js';
import { getDestructiveCommandWarning } from '../../../tools/BashTool/destructiveCommandWarning.js';
import { parseSedEditCommand } from '../../../tools/BashTool/sedEditParser.js';
import { shouldUseSandbox } from '../../../tools/BashTool/shouldUseSandbox.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/bash/prefix.js';
import { extractRules } from '../../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js';
import { Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDecisionDebugInfo } from '../PermissionDecisionDebugInfo.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionExplainerContent, usePermissionExplainerUI } from '../PermissionExplanation.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { SedEditPermissionRequest } from '../SedEditPermissionRequest/SedEditPermissionRequest.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { bashToolUseOptions } from './bashToolUseOptions.js';
export function BashPermissionRequest(props) {
  const $ = _c(21);
  const {
    toolUseConfirm,
    toolUseContext,
    onDone,
    onReject,
    verbose,
    workerBadge
  } = props;
  let command;
  let description;
  let t0;
  if ($[0] !== toolUseConfirm.input) {
    ({
      command,
      description
    } = BashTool.inputSchema.parse(toolUseConfirm.input));
    t0 = parseSedEditCommand(command);
    $[0] = toolUseConfirm.input;
    $[1] = command;
    $[2] = description;
    $[3] = t0;
  } else {
    command = $[1];
    description = $[2];
    t0 = $[3];
  }
  const sedInfo = t0;
  if (sedInfo) {
    let t1;
    if ($[4] !== onDone || $[5] !== onReject || $[6] !== sedInfo || $[7] !== toolUseConfirm || $[8] !== toolUseContext || $[9] !== verbose || $[10] !== workerBadge) {
      t1 = <SedEditPermissionRequest toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} sedInfo={sedInfo} />;
      $[4] = onDone;
      $[5] = onReject;
      $[6] = sedInfo;
      $[7] = toolUseConfirm;
      $[8] = toolUseContext;
      $[9] = verbose;
      $[10] = workerBadge;
      $[11] = t1;
    } else {
      t1 = $[11];
    }
    return t1;
  }
  let t1;
  if ($[12] !== command || $[13] !== description || $[14] !== onDone || $[15] !== onReject || $[16] !== toolUseConfirm || $[17] !== toolUseContext || $[18] !== verbose || $[19] !== workerBadge) {
    t1 = <BashPermissionRequestInner toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} command={command} description={description} />;
    $[12] = command;
    $[13] = description;
    $[14] = onDone;
    $[15] = onReject;
    $[16] = toolUseConfirm;
    $[17] = toolUseContext;
    $[18] = verbose;
    $[19] = workerBadge;
    $[20] = t1;
  } else {
    t1 = $[20];
  }
  return t1;
}

// Inner component that uses hooks - only called for non-MCP CLI commands
function BashPermissionRequestInner({
  toolUseConfirm,
  toolUseContext,
  onDone,
  onReject,
  verbose: _verbose,
  workerBadge,
  command,
  description
}: PermissionRequestProps & {
  command: string;
  description?: string;
}): React.ReactNode {
  const [theme] = useTheme();
  const explainerState = usePermissionExplainerUI({
    toolName: toolUseConfirm.tool.name,
    toolInput: toolUseConfirm.input,
    toolDescription: toolUseConfirm.description,
    messages: toolUseContext.messages
  });
  const {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: explainerState.visible
  });
  const [showPermissionDebug, setShowPermissionDebug] = useState(false);
  // GH#11380: For compound commands (cd src && git status && npm test), the
  // backend already computed correct per-subcommand suggestions via tree-sitter
  // split + per-subcommand permission checks. decisionReason.type ===
  // 'subcommandResults' marks this path. The sync prefix heuristics below
  // (getSimpleCommandPrefix/getFirstWordPrefix) operate on the FULL compound
  // string and pick the first two words — producing dead rules like
  // `Bash(cd src:*)` or `Bash(./script.sh && npm test)` that never match again.
  // Users accumulate 150+ of these in settings.local.json.
  //
  // When compound with exactly one Bash rule (e.g. `cd src && npm test` where
  // cd is read-only → only npm test needs approval), seed the editable input
  // from the backend rule. When compound with 2+ rules, editablePrefix stays
  // undefined so bashToolUseOptions falls through to yes-apply-suggestions,
  // which saves all per-subcommand rules atomically.
  const isCompound = toolUseConfirm.permissionResult.decisionReason?.type === 'subcommandResults';

  // Editable prefix — initialize synchronously with the best prefix we can
  // extract without tree-sitter, then refine via tree-sitter for compound
  // commands. The sync path matters because TREE_SITTER_BASH is gated
  // ant-only: in external builds the async refinement below always resolves
  // to [] and this initial value is what the user sees.
  //
  // Lazy initializer: this runs regex + split on every render if left in
  // the render body; it's only needed for initial state.
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => {
    if (isCompound) {
      // Backend suggestion is the source of truth for compound commands.
      // Single rule → seed the editable input so the user can refine it.
      // Multiple/zero rules → undefined → yes-apply-suggestions handles it.
      const backendBashRules = extractRules('suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions : undefined).filter(r => r.toolName === BashTool.name && r.ruleContent);
      return backendBashRules.length === 1 ? backendBashRules[0]!.ruleContent : undefined;
    }
    const two = getSimpleCommandPrefix(command);
    if (two) return `${two}:*`;
    const one = getFirstWordPrefix(command);
    if (one) return `${one}:*`;
    return command;
  });
  const hasUserEditedPrefix = useRef(false);
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
  useEffect(() => {
    // Skip async refinement for compound commands — the backend already ran
    // the full per-subcommand analysis and its suggestion is correct.
    if (isCompound) return;
    let cancelled = false;
    getCompoundCommandPrefixesStatic(command, subcmd => BashTool.isReadOnly({
      command: subcmd
    })).then(prefixes => {
      if (cancelled || hasUserEditedPrefix.current) return;
      if (prefixes.length > 0) {
        setEditablePrefix(`${prefixes[0]}:*`);
      }
    }).catch(() => {}); // Keep sync prefix on tree-sitter failure
    return () => {
      cancelled = true;
    };
  }, [command, isCompound]);

  // These derive solely from the tool input (fixed for the dialog lifetime).
  const {
    destructiveWarning: destructiveWarning_0,
    sandboxingEnabled: sandboxingEnabled_0,
    isSandboxed: isSandboxed_0
  } = useMemo(() => {
    const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false) ? getDestructiveCommandWarning(command) : null;
    const sandboxingEnabled = SandboxManager.isSandboxingEnabled();
    const isSandboxed = sandboxingEnabled && shouldUseSandbox(toolUseConfirm.input);
    return {
      destructiveWarning,
      sandboxingEnabled,
      isSandboxed
    };
  }, [command, toolUseConfirm.input]);
  const unaryEvent = useMemo<UnaryEvent>(() => ({
    completion_type: 'tool_use_single',
    language_name: 'none'
  }), []);
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const options = useMemo(() => bashToolUseOptions({
    suggestions: toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
    onRejectFeedbackChange: setRejectFeedback,
    onAcceptFeedbackChange: setAcceptFeedback,
    yesInputMode,
    noInputMode,
    editablePrefix,
    onEditablePrefixChange
  }), [toolUseConfirm, yesInputMode, noInputMode, editablePrefix, onEditablePrefixChange]);

  // Toggle permission debug info with keybinding
  const handleToggleDebug = useCallback(() => {
    setShowPermissionDebug(prev => !prev);
  }, []);
  useKeybinding('permission:toggleDebug', handleToggleDebug, {
    context: 'Confirmation'
  });

  function onSelect(value_0: string) {
    // Map options to numeric values for analytics (strings not allowed in logEvent)
    let optionIndex: Record<string, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      no: 3
    };
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value_0],
      explainer_visible: explainerState.visible
    });
    const toolNameForAnalytics = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    if (value_0 === 'yes-prefix-edited') {
      const trimmedPrefix = (editablePrefix ?? '').trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedPrefix) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const prefixUpdates: PermissionUpdate[] = [{
          type: 'addRules',
          rules: [{
            toolName: BashTool.name,
            ruleContent: trimmedPrefix
          }],
          behavior: 'allow',
          destination: 'localSettings'
        }];
        toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates);
      }
      onDone();
      return;
    }
    switch (value_0) {
      case 'yes':
        {
          const trimmedFeedback_0 = acceptFeedback.trim();
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Log accept submission with feedback context
          logEvent('tengu_accept_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback_0,
            instructions_length: trimmedFeedback_0.length,
            entered_feedback_mode: yesFeedbackModeEntered
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback_0 || undefined);
          onDone();
          break;
        }
      case 'yes-apply-suggestions':
        {
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Extract suggestions if present (works for both 'ask' and 'passthrough' behaviors)
          const permissionUpdates_0 = 'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions || [] : [];
          toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates_0);
          onDone();
          break;
        }
      case 'no':
        {
          const trimmedFeedback = rejectFeedback.trim();

          // Log reject submission with feedback context
          logEvent('tengu_reject_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: noFeedbackModeEntered
          });

          // Process rejection (with or without feedback)
          handleReject(trimmedFeedback || undefined);
          break;
        }
    }
  }
  return <PermissionDialog workerBadge={workerBadge} title={sandboxingEnabled_0 && !isSandboxed_0 ? 'Bash command (unsandboxed)' : 'Bash command'}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor={explainerState.visible}>
          {BashTool.renderToolUseMessage({
          command,
          description
        }, {
          theme,
          verbose: true
        } // always show the full command
        )}
        </Text>
        {!explainerState.visible && <Text dimColor>{toolUseConfirm.description}</Text>}
        <PermissionExplainerContent visible={explainerState.visible} promise={explainerState.promise} />
      </Box>
      {showPermissionDebug ? <>
          <PermissionDecisionDebugInfo permissionResult={toolUseConfirm.permissionResult} toolName="Bash" />
          {toolUseContext.options.debug && <Box justifyContent="flex-end" marginTop={1}>
              <Text dimColor>Ctrl-D to hide debug info</Text>
            </Box>}
        </> : <>
          <Box flexDirection="column">
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
            {destructiveWarning_0 && <Box marginBottom={1}>
                <Text color="warning">
                  {destructiveWarning_0}
                </Text>
              </Box>}
            <Text>
              Do you want to proceed?
            </Text>
            <Select options={options} inlineDescriptions onChange={onSelect} onCancel={() => handleReject()} onFocus={handleFocus} onInputModeToggle={handleInputModeToggle} />
          </Box>
          <Box justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              Esc to cancel
              {(focusedOption === 'yes' && !yesInputMode || focusedOption === 'no' && !noInputMode) && ' · Tab to amend'}
              {explainerState.enabled && ` · ctrl+e to ${explainerState.visible ? 'hide' : 'explain'}`}
            </Text>
            {toolUseContext.options.debug && <Text dimColor>Ctrl+d to show debug info</Text>}
          </Box>
        </>}
    </PermissionDialog>;
}
