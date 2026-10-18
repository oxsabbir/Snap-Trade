import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const FONT_SIZE_OPTIONS = [
  { label: 'Smallest', shortLabel: 'A−−', scale: 0.85 },
  { label: 'Smaller', shortLabel: 'A−', scale: 0.925 },
  { label: 'Default', shortLabel: 'A', scale: 1 },
  { label: 'Larger', shortLabel: 'A+', scale: 1.075 },
  { label: 'Largest', shortLabel: 'A++', scale: 1.15 },
] as const;

const DEFAULT_STEP = 2;
const STORAGE_KEY = 'appearance:font-size-step';

type FontScaleContextValue = {
  step: number;
  scale: number;
  setStep: (step: number) => void;
};

const FontScaleContext = createContext<FontScaleContextValue | undefined>(undefined);

function parseStep(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < FONT_SIZE_OPTIONS.length
    ? parsed
    : null;
}

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [step, setStepState] = useState(DEFAULT_STEP);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        const savedStep = parseStep(stored);
        if (!cancelled && savedStep !== null) setStepState(savedStep);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setStep = useCallback((next: number) => {
    if (!Number.isInteger(next) || next < 0 || next >= FONT_SIZE_OPTIONS.length) return;
    setStepState(next);
    void AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ step, scale: FONT_SIZE_OPTIONS[step]!.scale, setStep }),
    [step, setStep],
  );

  return <FontScaleContext.Provider value={value}>{children}</FontScaleContext.Provider>;
}

export function useFontScale(): FontScaleContextValue {
  const context = useContext(FontScaleContext);
  if (!context) throw new Error('useFontScale must be used inside FontScaleProvider');
  return context;
}
