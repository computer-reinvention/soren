import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from './QuestionCard';
import type { PendingQuestion } from '@/lib/api';

function makeQuestion(overrides: Partial<PendingQuestion['questions'][0]> = {}): PendingQuestion {
  return {
    call_id: 'call_1',
    questions: [
      {
        question: 'Approve deploy?',
        header: 'Deploy check',
        options: [
          { label: 'Yes', description: 'Ship it' },
          { label: 'No', description: 'Hold off' },
        ],
        ...overrides,
      },
    ],
  };
}

describe('QuestionCard — single-select', () => {
  it('renders the question text, header, and options', () => {
    render(<QuestionCard question={makeQuestion()} onAnswer={vi.fn()} isSubmitting={false} />);
    expect(screen.getByText('Approve deploy?')).toBeInTheDocument();
    expect(screen.getByText('Deploy check')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
  });

  it('submits immediately on click for a single-select question', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={makeQuestion()} onAnswer={onAnswer} isSubmitting={false} />);
    fireEvent.click(screen.getByText('Yes'));
    expect(onAnswer).toHaveBeenCalledWith('Yes');
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('does not submit when disabled by isSubmitting', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={makeQuestion()} onAnswer={onAnswer} isSubmitting={true} />);
    fireEvent.click(screen.getByText('Yes'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no questions', () => {
    const empty: PendingQuestion = { call_id: 'call_1', questions: [] };
    const { container } = render(
      <QuestionCard question={empty} onAnswer={vi.fn()} isSubmitting={false} />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('QuestionCard — multi-select', () => {
  function makeMultiQuestion(): PendingQuestion {
    return {
      call_id: 'call_2',
      questions: [
        {
          question: 'What should I set up?',
          header: 'Next step',
          multiple: true,
          options: [
            { label: 'Activate projects only', description: 'a' },
            { label: 'Set up permanent teams', description: 'b' },
            { label: 'Nothing yet', description: 'c' },
          ],
        },
      ],
    };
  }

  it('does not submit on a single option click — requires the Submit button', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={makeMultiQuestion()} onAnswer={onAnswer} isSubmitting={false} />);
    fireEvent.click(screen.getByText('Activate projects only'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('Submit button is disabled until at least one option is selected', () => {
    render(<QuestionCard question={makeMultiQuestion()} onAnswer={vi.fn()} isSubmitting={false} />);
    const submitButton = screen.getByRole('button', { name: /submit/i });
    expect(submitButton).toBeDisabled();
  });

  it('submits a comma-separated list of selected labels, matching opencode\'s own answer format', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={makeMultiQuestion()} onAnswer={onAnswer} isSubmitting={false} />);
    fireEvent.click(screen.getByText('Activate projects only'));
    fireEvent.click(screen.getByText('Set up permanent teams'));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onAnswer).toHaveBeenCalledWith('Activate projects only, Set up permanent teams');
  });

  it('toggling an option twice deselects it', () => {
    render(<QuestionCard question={makeMultiQuestion()} onAnswer={vi.fn()} isSubmitting={false} />);
    const option = screen.getByText('Activate projects only');
    fireEvent.click(option);
    fireEvent.click(option);
    const submitButton = screen.getByRole('button', { name: /submit/i });
    expect(submitButton).toBeDisabled();
  });
});
