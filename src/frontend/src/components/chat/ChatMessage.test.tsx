import { describe, it, expect, afterEach } from 'vitest';
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

/** useIsMobile() reads window.innerWidth directly (see hooks/use-mobile.tsx). */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
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

// Regression guard for a second real bug found in the same pass: a long
// unbroken token (hash, no-slash path, URL) in either an agent's markdown
// reply or a plain user bubble overflowed the container's width instead of
// wrapping — invisible on a wide desktop pane, but on a ~350px phone
// screen it pushed real content past the edge of the viewport entirely.
describe('ChatMessage — long unbroken tokens wrap instead of overflowing', () => {
  it('breaks words in agent markdown content', () => {
    const { container } = renderMessage({ message: makeMessage({ content: 'short' }) });
    const content = container.querySelector('.prose');
    expect(content?.className).toMatch(/break-words/);
  });

  it('breaks words in a user message bubble', () => {
    const { container } = renderMessage({
      message: makeMessage({ type: 'user', from_agent: 'user', content: 'hi there' }),
    });
    const bubble = container.querySelector('.whitespace-pre-wrap');
    expect(bubble?.className).toMatch(/break-words/);
  });
});

// Regression guard for the mobile chat layout rebuild: the desktop log
// layout's fixed-width timestamp (58px) + sender (120px) columns ate
// ~180px of a ~390px phone screen before any message content started,
// forcing text into a ~200px column that wrapped every few words — this
// was reported directly as "the layout breaks" on mobile. Mobile now
// stacks sender+time into one compact header row instead and gives
// content the full width.
describe('ChatMessage — mobile layout', () => {
  afterEach(() => {
    setViewportWidth(1024);
  });

  it('does not use the desktop fixed-width timestamp/sender columns', () => {
    setViewportWidth(390);
    const { container } = renderMessage({ message: makeMessage({ content: 'short reply' }) });
    expect(container.querySelector('.w-\\[58px\\]')).toBeNull();
    expect(container.querySelector('.w-\\[120px\\]')).toBeNull();
  });

  it('puts message actions inline in the header row for every message, badged or not', () => {
    setViewportWidth(390);
    const { getByRole } = renderMessage({ message: makeMessage({ content: 'short reply' }) });
    expect(getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
  });
});
