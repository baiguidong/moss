import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { setupTerminal, shouldOfferTerminalSetup } from '../commands/terminalSetup/terminalSetup.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Newline, Text, useTheme } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { normalizeApiKeyForConfig } from '../utils/authPortable.js';
import { getCustomApiKeyStatus } from '../utils/config.js';
import { env } from '../utils/env.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import type { ThemeSetting } from '../utils/theme.js';
import { ApproveApiKey } from './ApproveApiKey.js';
import { Select } from './CustomSelect/select.js';
import { WelcomeV2 } from './LogoV2/WelcomeV2.js';
import { PressEnterToContinue } from './PressEnterToContinue.js';
import { ThemePicker } from './ThemePicker.js';
import { OrderedList } from './ui/OrderedList.js';
type StepId = 'theme' | 'api-key' | 'security' | 'terminal-setup';
interface OnboardingStep {
  id: StepId;
  component: React.ReactNode;
}
type Props = {
  onDone(): void;
};
export function Onboarding({
  onDone
}: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    logEvent('tengu_began_setup', {});
  }, []);
  function goToNextStep() {
    if (currentStepIndex < steps.length - 1) {
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      logEvent('tengu_onboarding_step', {
        stepId: steps[nextIndex]?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    } else {
      onDone();
    }
  }
  function handleThemeSelection(newTheme: ThemeSetting) {
    setTheme(newTheme);
    goToNextStep();
  }
  const exitState = useExitOnCtrlCDWithKeybindings();

  // Define all onboarding steps
  const themeStep = <Box marginX={1}>
      <ThemePicker onThemeSelect={handleThemeSelection} showIntroText={true} helpText="To change this later, run /theme" hideEscToCancel={true} skipExitHandling={true} // Skip exit handling as Onboarding already handles it
    />
    </Box>;
  const securityStep = <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>安全提示：</Text>
      <Box flexDirection="column" width={70}>
        {/**
         * OrderedList misnumbers items when rendering conditionally,
         * so put all items in the if/else
         */}
        <OrderedList>
          <OrderedList.Item>
            <Text>Moss 可能会出错</Text>
            <Text dimColor wrap="wrap">
              请始终检查 Moss 的回答，尤其是在
              <Newline />
              运行代码时。
              <Newline />
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>
              由于存在提示词注入风险，请只在你信任的代码上使用 Moss
            </Text>
            <Text dimColor wrap="wrap">
              详情请查看本地 Moss 安全文档。
            </Text>
          </OrderedList.Item>
        </OrderedList>
      </Box>
      <PressEnterToContinue />
    </Box>;
  // Create the API-key-only onboarding steps.
  const apiKeyNeedingApproval = useMemo(() => {
    // Add API key step if needed
    // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
    // processes but ignored by Moss itself (see auth.ts).
    if (!process.env.ANTHROPIC_API_KEY || isRunningOnHomespace()) {
      return '';
    }
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    if (getCustomApiKeyStatus(customApiKeyTruncated) === 'new') {
      return customApiKeyTruncated;
    }
  }, []);
  function handleApiKeyDone() {
    goToNextStep();
  }
  const steps: OnboardingStep[] = [];
  steps.push({
    id: 'theme',
    component: themeStep
  });
  if (apiKeyNeedingApproval) {
    steps.push({
      id: 'api-key',
      component: <ApproveApiKey customApiKeyTruncated={apiKeyNeedingApproval} onDone={handleApiKeyDone} />
    });
  }
  steps.push({
    id: 'security',
    component: securityStep
  });
  if (shouldOfferTerminalSetup()) {
    steps.push({
      id: 'terminal-setup',
      component: <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>使用 Moss 的终端设置？</Text>
          <Box flexDirection="column" width={70} gap={1}>
            <Text>
              为获得最佳编码体验，启用终端推荐设置
              <Newline />
              for your terminal:{' '}
              {env.terminal === 'Apple_Terminal' ? 'Option+Enter for newlines and visual bell' : 'Shift+Enter for newlines'}
            </Text>
            <Select options={[{
            label: '是，使用推荐设置',
            value: 'install'
          }, {
            label: '否，稍后通过 /terminal-setup 设置',
            value: 'no'
          }]} onChange={value => {
            if (value === 'install') {
              // Errors already logged in setupTerminal, just swallow and proceed
              void setupTerminal(theme).catch(() => {}).finally(goToNextStep);
            } else {
              goToNextStep();
            }
          }} onCancel={() => goToNextStep()} />
            <Text dimColor>
              {exitState.pending ? <>再次按 {exitState.keyName} 退出</> : <>Enter 确认 · Esc 跳过</>}
            </Text>
          </Box>
        </Box>
    });
  }
  const currentStep = steps[currentStepIndex];

  // Handle Enter on security step and Escape on terminal-setup step
  // Dependencies match what goToNextStep uses internally
  const handleSecurityContinue = useCallback(() => {
    if (currentStepIndex === steps.length - 1) {
      onDone();
    } else {
      goToNextStep();
    }
  }, [currentStepIndex, steps.length, onDone]);
  const handleTerminalSetupSkip = useCallback(() => {
    goToNextStep();
  }, [currentStepIndex, steps.length, onDone]);
  useKeybindings({
    'confirm:yes': handleSecurityContinue
  }, {
    context: 'Confirmation',
    isActive: currentStep?.id === 'security'
  });
  useKeybindings({
    'confirm:no': handleTerminalSetupSkip
  }, {
    context: 'Confirmation',
    isActive: currentStep?.id === 'terminal-setup'
  });
  return <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && <Box padding={1}>
            <Text dimColor>再次按 {exitState.keyName} 退出</Text>
          </Box>}
      </Box>
    </Box>;
}
