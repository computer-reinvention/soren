import { describe, it, expect } from 'vitest';
import { useSettingsPanelStore } from './settingsPanelStore';

describe('settingsPanelStore', () => {
  it('starts closed', () => {
    expect(useSettingsPanelStore.getState().open).toBe(false);
  });

  it('setOpen toggles the dialog state', () => {
    useSettingsPanelStore.getState().setOpen(true);
    expect(useSettingsPanelStore.getState().open).toBe(true);
    useSettingsPanelStore.getState().setOpen(false);
    expect(useSettingsPanelStore.getState().open).toBe(false);
  });
});
