import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalSettingsStore } from './terminalSettingsStore';

describe('terminalSettingsStore', () => {
  beforeEach(() => {
    useTerminalSettingsStore.setState({ fontSize: 13, scrollback: 10_000 });
  });

  it('increases font size by the fixed step', () => {
    useTerminalSettingsStore.getState().increaseFontSize();
    expect(useTerminalSettingsStore.getState().fontSize).toBe(14);
  });

  it('decreases font size by the fixed step', () => {
    useTerminalSettingsStore.getState().decreaseFontSize();
    expect(useTerminalSettingsStore.getState().fontSize).toBe(12);
  });

  it('clamps font size at the documented maximum (20)', () => {
    useTerminalSettingsStore.setState({ fontSize: 20 });
    useTerminalSettingsStore.getState().increaseFontSize();
    expect(useTerminalSettingsStore.getState().fontSize).toBe(20);
  });

  it('clamps font size at the documented minimum (10)', () => {
    useTerminalSettingsStore.setState({ fontSize: 10 });
    useTerminalSettingsStore.getState().decreaseFontSize();
    expect(useTerminalSettingsStore.getState().fontSize).toBe(10);
  });

  it('clamps scrollback within [500, 50000]', () => {
    useTerminalSettingsStore.getState().setScrollback(100);
    expect(useTerminalSettingsStore.getState().scrollback).toBe(500);

    useTerminalSettingsStore.getState().setScrollback(999_999);
    expect(useTerminalSettingsStore.getState().scrollback).toBe(50_000);
  });

  it('accepts an in-range scrollback value as-is', () => {
    useTerminalSettingsStore.getState().setScrollback(25_000);
    expect(useTerminalSettingsStore.getState().scrollback).toBe(25_000);
  });
});
