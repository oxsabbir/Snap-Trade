import { useState } from 'react';

import { SetupScreen } from '@/components/SetupScreen';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useApiCredentials } from '@/state/apiCredentials';
import type { OnboardingEntry } from '@/state/apiCredentials';

export default function OnboardingRoute() {
  const { onboardingEntry, connect, activateConnectedAccount } = useApiCredentials();
  const [screen, setScreen] = useState<OnboardingEntry>(onboardingEntry);

  if (screen === 'welcome') {
    return <WelcomeScreen onSetup={() => setScreen('setup')} />;
  }

  return (
    <SetupScreen
      onConnect={connect}
      onConnected={activateConnectedAccount}
    />
  );
}