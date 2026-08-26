import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalSettingsStore } from './terminalSettingsStore';

describe('terminalSettingsStore', () => {
  beforeEach(() => {
    useTerminalSettingsStore.setState({ desktopFontSize: 13, mobileFontSize: 8, scrollback: 10_000 });
  });

  it('increases desktop font size by the fixed step, leaving mobile untouched', () => {
    useTerminalSettingsStore.getState().increaseFontSize(false);
    expect(useTerminalSettingsStore.getState().desktopFontSize).toBe(14);
    expect(useTerminalSettingsStore.getState().mobileFontSize).toBe(8);
  });

  it('decreases desktop font size by the fixed step', () => {
    useTerminalSettingsStore.getState().decreaseFontSize(false);
    expect(useTerminalSettingsStore.getState().desktopFontSize).toBe(12);
  });

  it('increases mobile font size independently of desktop', () => {
    useTerminalSettingsStore.getState().increaseFontSize(true);
    expect(useTerminalSettingsStore.getState().mobileFontSize).toBe(9);
    expect(useTerminalSettingsStore.getState().desktopFontSize).toBe(13);
  });

  it('decreases mobile font size by the fixed step', () => {
    useTerminalSettingsStore.getState().decreaseFontSize(true);
    expect(useTerminalSettingsStore.getState().mobileFontSize).toBe(7);
  });

  it('clamps desktop font size at the documented maximum (20)', () => {
    useTerminalSettingsStore.setState({ desktopFontSize: 20 });
    useTerminalSettingsStore.getState().increaseFontSize(false);
    expect(useTerminalSettingsStore.getState().desktopFontSize).toBe(20);
  });

  it('clamps mobile font size at the documented minimum (6)', () => {
    useTerminalSettingsStore.setState({ mobileFontSize: 6 });
    useTerminalSettingsStore.getState().decreaseFontSize(true);
    expect(useTerminalSettingsStore.getState().mobileFontSize).toBe(6);
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
