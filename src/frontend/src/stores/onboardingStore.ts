import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  hasSeenOnboarding: boolean;
  setHasSeenOnboarding: (value: boolean) => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasSeenOnboarding: false,
      setHasSeenOnboarding: (value) => set({ hasSeenOnboarding: value }),
      resetOnboarding: () => set({ hasSeenOnboarding: false }),
    }),
    {
      name: 'soren-onboarding',
    }
  )
);
