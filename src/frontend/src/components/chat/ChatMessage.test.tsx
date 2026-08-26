import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatMessage } from './ChatMessage';
import type { Message } from '@/types/message';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    timestamp: '2026-08-26T10:00:00Z',
    from_agent: 'supervisor',
    to_agent: 'user',
    type: 'response',
    content: 'Short reply.',
    ...overrides,
  };
}

function renderMessage(props: Partial<React.ComponentProps<typeof ChatMessage>> = {}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ChatMessage message={makeMessage()} {...props} />
      </TooltipProvider>
    </MemoryRouter>
  );
}

// Regression guard for a real bug found while building the mobile chat
// view: bare messages (no agent/prefix/collapse badge row) render their
// copy/view-raw actions as an `absolute top-1 right-1` overlay rather than
// inline. `can-hover:opacity-0` only hides that overlay on devices that
// support real hover — on touch (mobile), it's permanently visible — so
// without reserved space, short-wrapped lines render directly underneath
// the icons on a narrow viewport. See tailwind.config.js's `can-hover`
// variant comment for why touch intentionally always shows it.
describe('ChatMessage — action overlay clearance', () => {
  it('reserves right-padding for the action overlay on a bare message (no badge row)', () => {
    const { container } = renderMessage({ message: makeMessage({ content: 'Short reply.' }) });
    const content = container.querySelector('.prose');
    expect(content).not.toBeNull();
    expect(content?.className).toMatch(/pr-20/);
  });

  it('does not add overlay clearance once a badge row is present (actions render inline there instead)', () => {
    const { container } = renderMessage({
      message: makeMessage({ content: 'Repeated reply.' }),
      collapseCount: 3,
    });
    const content = container.querySelector('.prose');
    expect(content).not.toBeNull();
    expect(content?.className).not.toMatch(/pr-20/);
  });

  it('reserves clearance on a plain user bubble too', () => {
    const { container } = renderMessage({
      message: makeMessage({ type: 'user', from_agent: 'user', content: 'hi there' }),
    });
    const bubble = container.querySelector('.whitespace-pre-wrap');
    expect(bubble).not.toBeNull();
    expect(bubble?.className).toMatch(/pr-20/);
  });
});
