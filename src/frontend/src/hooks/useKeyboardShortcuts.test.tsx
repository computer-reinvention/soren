import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const AGENTS = [
  { id: 'supervisor', name: 'supervisor', type: 'supervisor', status: 'IDLE', tmux_window: '0', session: '', created_at: '', last_activity: null, current_task: null },
  { id: 'worker-a', name: 'worker-a', type: 'worker', status: 'IDLE', tmux_window: '1', session: '', created_at: '', last_activity: null, current_task: null },
  { id: 'worker-b', name: 'worker-b', type: 'worker', status: 'IDLE', tmux_window: '2', session: '', created_at: '', last_activity: null, current_task: null },
];

function TestHost() {
  useKeyboardShortcuts();
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function renderWithProviders(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['agents'], { agents: AGENTS, total: AGENTS.length });
  queryClient.setQueryData(['projects'], { projects: [] });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TestHost />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('"j" navigates to the first agent when none is currently selected', () => {
    renderWithProviders('/');
    press('j');
    expect(screen.getByTestId('path')).toHaveTextContent('/agents/supervisor');
  });

  it('"j" then "j" again advances to the next agent in sidebar order', () => {
    renderWithProviders('/agents/supervisor');
    press('j');
    expect(screen.getByTestId('path')).toHaveTextContent('/agents/worker-a');
  });

  it('"k" moves to the previous agent, wrapping to the last one at the start', () => {
    renderWithProviders('/agents/supervisor');
    press('k');
    expect(screen.getByTestId('path')).toHaveTextContent('/agents/worker-b');
  });

  it('"g" then "o" navigates to the overview', () => {
    renderWithProviders('/agents/worker-a');
    press('g');
    press('o');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('"g" then "t" navigates to tasks', () => {
    renderWithProviders('/');
    press('g');
    press('t');
    expect(screen.getByTestId('path')).toHaveTextContent('/tasks');
  });

  it('Escape navigates back to the overview', () => {
    renderWithProviders('/tasks');
    press('Escape');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('ignores shortcut keys while focus is inside a text input', () => {
    renderWithProviders('/');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: 'j' });
    });
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('ignores shortcut keys while a dialog is open (except "?")', () => {
    renderWithProviders('/');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    press('j');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('"?" toggles the help overlay state', () => {
    let helpState: { helpOpen: boolean } | null = null;
    function Probe() {
      const { helpOpen } = useKeyboardShortcuts();
      helpState = { helpOpen };
      return null;
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['agents'], { agents: [], total: 0 });
    queryClient.setQueryData(['projects'], { projects: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(helpState!.helpOpen).toBe(false);
    press('?');
    expect(helpState!.helpOpen).toBe(true);
  });
});
