import { describe, expect, it } from 'vitest';
import { generatePuzzle, solve, validateBoard } from '../core';
import type { BoardSize, CellValue, Puzzle } from '../shared/types';
import { getHint, solveLogically } from './index';

// Шахматное поле удовлетворяет балансу и запрету троек на каждом размере.
function fixture(size: BoardSize): { puzzle: Puzzle; board: CellValue[] } {
  const full: CellValue[] = Array.from({ length: size * size }, (_, i) => (Math.floor(i / size) + i % size) % 2 ? 'moon' : 'sun');
  const givens = full.map((v, i) => i % (size + 1) === 0 ? null : v);
  return { puzzle: { id: 'test', size, givens, relations: [], seed: 'test', rulesVersion: 1 }, board: [...givens] };
}

describe('объяснимые подсказки', () => {
  for (const size of [6, 8, 10] as const) it(`доказывает каждый шаг и завершает поле ${size}×${size}`, () => {
    const { puzzle, board } = fixture(size);
    const initial = [...board];
    const result = solveLogically(puzzle, board);
    expect(result.solved).toBe(true);
    expect(board).toEqual(initial);
    const current = [...board];
    for (const hint of result.steps) {
      expect(hint.kind).toBe('step');
      if (hint.kind !== 'step') throw new Error('Ожидался шаг');
      expect(solve(puzzle, current, { limit: 1 }).solutions.length).toBeGreaterThan(0);
      expect(getHint(puzzle, current)).toEqual(hint);
      const alternative = [...current];
      alternative[hint.index] = hint.value === 'sun' ? 'moon' : 'sun';
      const proof = solve(puzzle, alternative, { limit: 1 });
      expect(proof.complete).toBe(true);
      expect(proof.solutions).toHaveLength(0);
      current[hint.index] = hint.value;
    }
  });
  it('обнаруживает непосредственный конфликт, не предлагая ход', () => {
    const { puzzle, board } = fixture(6);
    board[1] = 'sun';
    expect(getHint(puzzle, board).kind).toBe('conflict');
  });
  it('передаёт значение по связи и указывает её', () => {
    const { puzzle, board } = fixture(6);
    puzzle.relations = [{ a: 0, b: 1, type: 'different' }];
    const hint = getHint(puzzle, board);
    expect(hint).toMatchObject({ kind: 'step', index: 0, value: 'sun', rule: 'relation', relatedRelations: [0] });
  });
});

import verification from '../../docs/01-verification.json?raw';

describe('сертифицированные примеры', () => {
  const records: { size: BoardSize; seed: number; generation_policy: string; givens: { row: number; column: number; symbol: string }[]; edges: { from: number[]; to: number[]; relation: string }[] }[] = JSON.parse(verification).generated_puzzles;
  for (const record of records.filter(r => r.generation_policy === 'единственность и вывод по линиям')) {
    it(`решает размер ${record.size}, seed ${record.seed} без ответа`, () => {
      const givens: CellValue[] = Array(record.size ** 2).fill(null);
      for (const cell of record.givens) givens[(cell.row - 1) * record.size + cell.column - 1] = cell.symbol === 'солнце' ? 'sun' : 'moon';
      const index = (position: number[]) => (position[0] - 1) * record.size + position[1] - 1;
      const puzzle: Puzzle = { id: 'fixture', size: record.size, seed: String(record.seed), rulesVersion: 1, givens, relations: record.edges.map(edge => ({ a: index(edge.from), b: index(edge.to), type: edge.relation === '=' ? 'equal' : 'different' })) };
      const result = solveLogically(puzzle);
      expect(result.solved).toBe(true);
      for (const hint of result.steps.filter(h => h.kind === 'step' && h.rule === 'line-candidates')) {
        if (hint.kind !== 'step') continue;
        expect(hint.message.length).toBeLessThan(150);
        expect(hint.details?.length).toBeGreaterThan(1);
      }
    });
  }
});

describe('генератор', () => {
  for (const size of [6, 8, 10] as const) it(`решает сгенерированную задачу ${size}×${size}`, () => {
    const puzzle = generatePuzzle({ size, seed: 'подсказки', maxAttempts: 1 });
    const result = solveLogically(puzzle);
    expect(result.solved).toBe(true);
    const board = [...puzzle.givens];
    for (const hint of result.steps) {
      if (hint.kind !== 'step') throw new Error('Ожидался шаг');
      expect(solve(puzzle, board, { limit: 1 }).solutions.length).toBeGreaterThan(0);
      const opposite = [...board]; opposite[hint.index] = hint.value === 'sun' ? 'moon' : 'sun';
      const proof = solve(puzzle, opposite, { limit: 1 });
      expect(proof.complete).toBe(true);
      expect(proof.solutions).toHaveLength(0);
      board[hint.index] = hint.value;
    }
  });
});

describe('состояния и локальные правила', () => {
  const empty = (): Puzzle => ({ id: 'empty', size: 6, seed: 'x', rulesVersion: 1, givens: Array(36).fill(null), relations: [] });
  it('различает глобальную несовместимость и ограничение поиска', () => {
    const puzzle = empty();
    puzzle.relations = [{ a: 0, b: 1, type: 'different' }, { a: 1, b: 2, type: 'different' }];
    const board = [...puzzle.givens]; board[0] = 'sun'; board[2] = 'moon';
    expect(validateBoard(puzzle, board).valid).toBe(true);
    expect(getHint(puzzle, board).kind).toBe('conflict');
    expect(getHint(empty(), Array(36).fill(null), { maxNodes: 0 }).kind).toBe('stuck');
  });
  it('распознаёт завершённое и неоднозначное пустое поле', () => {
    const { puzzle } = fixture(6);
    const full: CellValue[] = Array.from({ length: 36 }, (_, i) => (Math.floor(i / 6) + i % 6) % 2 ? 'moon' : 'sun');
    expect(getHint(puzzle, full).kind).toBe('complete');
    expect(getHint(empty(), Array(36).fill(null)).kind).toBe('stuck');
  });
  it('объясняет запрет троек и насыщение баланса', () => {
    const puzzle = empty();
    const board: CellValue[] = Array(36).fill(null); board[0] = 'sun'; board[2] = 'sun';
    expect(getHint(puzzle, board)).toMatchObject({ kind: 'step', index: 1, value: 'moon', rule: 'no-three' });
    ['sun', 'moon', 'sun', 'moon', 'sun'].forEach((v, i) => { board[i] = v as CellValue; });
    expect(getHint(puzzle, board)).toMatchObject({ kind: 'step', index: 5, value: 'moon', rule: 'balance' });
  });
  it('не изменяет условия и поле и повторяет тот же результат', () => {
    const { puzzle, board } = fixture(6);
    const before = structuredClone({ puzzle, board });
    expect(getHint(puzzle, board)).toEqual(getHint(puzzle, board));
    solveLogically(puzzle, board);
    expect({ puzzle, board }).toEqual(before);
  });
});

it('показывает отдельное доказательство сложного вывода', () => {
  const records = JSON.parse(verification).generated_puzzles as { size: BoardSize; seed: number; generation_policy: string; givens: { row: number; column: number; symbol: string }[]; edges: { from: number[]; to: number[]; relation: string }[] }[];
  let found = false;
  for (const r of records.filter(x => x.generation_policy === 'единственность и вывод по линиям')) {
    const givens: CellValue[] = Array(r.size ** 2).fill(null);
    for (const c of r.givens) givens[(c.row - 1) * r.size + c.column - 1] = c.symbol === 'солнце' ? 'sun' : 'moon';
    const index = (p: number[]) => (p[0] - 1) * r.size + p[1] - 1;
    const puzzle: Puzzle = { id: 'trace', size: r.size, seed: String(r.seed), rulesVersion: 1, givens, relations: r.edges.map(e => ({ a: index(e.from), b: index(e.to), type: e.relation === '=' ? 'equal' : 'different' })) };
    for (const hint of solveLogically(puzzle).steps) if (hint.kind === 'step' && hint.rule === 'line-candidates') {
      found = true;
      expect(hint.message.length).toBeLessThan(150);
      expect(hint.details?.join(' ')).toMatch(/строк[аие]/);
      expect(hint.details?.join(' ')).toMatch(/столбц/);
    }
  }
  expect(found).toBe(true);
});
