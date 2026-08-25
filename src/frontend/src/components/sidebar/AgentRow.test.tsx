import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentRow } from './AgentRow';
import type { Agent } from '@/types/agent';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'dash-frontend',
    name: 'dash-frontend',
    type: 'worker',
    status: 'IN_PROGRESS',
    tmux_window: '1',
    session: 'ses_1',
    created_at: '',
    last_activity: null,
    current_task: null,
    ...overrides,
  };
}

function renderRow(agent: Agent, props: Partial<React.ComponentProps<typeof AgentRow>> = {}) {
  return render(
    <MemoryRouter>
      <AgentRow agent={agent} {...props} />
    </MemoryRouter>
  );
}

describe('AgentRow', () => {
  it('links to the agent detail route', () => {
    renderRow(makeAgent());
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/agents/dash-frontend');
  });

  it('shows the display name when set, falling back to name otherwise', () => {
    renderRow(makeAgent({ display_name: 'Dash Frontend' }));
    expect(screen.getByText('Dash Frontend')).toBeInTheDocument();
  });

  // P5.8 regression guard: the accessible name must reflect the live
  // status, not just the name — this is the only way a screen reader user
  // gets the same "is this agent working / blocked / idle" signal a
  // sighted user gets from the colored status dot.
  it('includes a human-readable status in the accessible name', () => {
    renderRow(makeAgent({ status: 'BLOCKED' }));
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).toContain('blocked');
  });

  it('renders sleeping agents at reduced opacity', () => {
    renderRow(makeAgent({ status: 'SLEEPING' }));
    expect(screen.getByRole('link').className).toMatch(/opacity-55/);
  });

  it('applies bold styling for the pinned supervisor row', () => {
    renderRow(makeAgent({ id: 'supervisor', name: 'supervisor' }), { isSupervisor: true });
    expect(screen.getByText('supervisor').className).toMatch(/font-semibold/);
  });
});
