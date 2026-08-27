import { describe, it, expect } from 'vitest';
import { getToolSummary, getToolLabel } from './toolSummary';

describe('getToolSummary — question tool', () => {
  it('summarizes the first question text', () => {
    const input = {
      questions: [
        { question: 'Approve deploy?', header: 'Deploy check', options: [] },
      ],
    };
    expect(getToolSummary('question', input)).toBe('Question: Approve deploy?');
  });

  it('truncates a long question', () => {
    const longQuestion = 'a'.repeat(100);
    const input = { questions: [{ question: longQuestion, options: [] }] };
    const result = getToolSummary('question', input);
    expect(result.startsWith('Question: ')).toBe(true);
    expect(result.length).toBeLessThan(80);
  });

  it('falls back to the bare tool name with no questions array', () => {
    expect(getToolSummary('question', {})).toBe('Question');
  });

  it('falls back to the bare tool name with no input at all', () => {
    expect(getToolSummary('question', undefined)).toBe('question');
  });
});

describe('getToolLabel — question tool', () => {
  it('labels the lowercase "question" tool name (opencode\'s real tool name)', () => {
    expect(getToolLabel('question')).toBe('Waiting for input');
  });
});
