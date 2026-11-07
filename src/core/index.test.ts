import { describe, expect, it } from 'vitest';
import verification from '../../docs/01-verification.json';
import type { BoardSize, CellValue, Puzzle, SymbolValue } from '../shared/types';
import { generatePuzzle, getLineCatalog, propagate, solve, validateBoard } from './index';

function empty(size: BoardSize): Puzzle {
  return { id: 'test', size, seed: 'test', rulesVersion: 1, givens: Array(size * size).fill(null), relations: [] };
}
// Независимая проверка полей не использует каталог и функции ядра.
function direct(puzzle: Puzzle, board: CellValue[]): boolean {
  const n = puzzle.size;
  if (board.some((v, i) => !v || (puzzle.givens[i] && puzzle.givens[i] !== v))) return false;
  const lines = Array.from({ length: 2*n }, (_, k) => Array.from({ length: n }, (_, i) => board[k < n ? k*n+i : i*n+k-n]));
  return lines.every(line => line.filter(v => v === 'sun').length === n/2 && line.every((v, i) => i < 2 || v !== line[i-1] || v !== line[i-2])) && puzzle.relations.every(e => (board[e.a] === board[e.b]) === (e.type === 'equal'));
}
const fixture = (entry: typeof verification.generated_puzzles[number]): { puzzle: Puzzle; answer: SymbolValue[] } => {
  const puzzle = empty(entry.size as BoardSize), n = puzzle.size;
  for (const g of entry.givens) puzzle.givens[(g.row-1)*n+g.column-1] = g.symbol === 'солнце' ? 'sun' : 'moon';
  puzzle.relations = entry.edges.map(e => ({ a: (e.from[0]-1)*n+e.from[1]-1, b: (e.to[0]-1)*n+e.to[1]-1, type: e.relation === '=' ? 'equal' : 'different' }));
  return { puzzle, answer: entry.solution.join('').split('').map(v => v === 'С' ? 'sun' : 'moon') };
};

describe('Каталоги и проверенные условия', () => {
  it.each([[6,14], [8,34], [10,84]] as const)('каталог %i содержит %i вариантов', (n, count) => {
    const catalog = getLineCatalog(n);
    expect(catalog).toHaveLength(count);
    expect(new Set(catalog.map(v => v.join(','))).size).toBe(count);
    for (const line of catalog) {
      expect(line.filter(v => v === 'sun')).toHaveLength(n/2);
      expect(line.every((v, i) => i < 2 || v !== line[i-1] || v !== line[i-2])).toBe(true);
    }
  });
  it('подтверждает решения и единственность всех девяти проверенных логических задач', () => {
    for (const entry of verification.generated_puzzles.filter(p => p.generation_policy === 'единственность и вывод по линиям')) {
      const { puzzle, answer } = fixture(entry);
      expect(direct(puzzle, answer)).toBe(true);
      const result = solve(puzzle);
      expect(result.complete).toBe(true);
      expect(result.solutions).toEqual([answer]);
      expect(propagate(puzzle, puzzle.givens).board).toEqual(answer);
      const noGivens = { ...puzzle, givens: Array(puzzle.size ** 2).fill(null) };
      expect(solve(noGivens).solutions).toHaveLength(2);
    }
  });
});

describe('Валидация и поиск', () => {
  it.each([6,8,10] as const)('пустое поле %i имеет несколько решений', n => {
    const puzzle = empty(n), original = [...puzzle.givens];
    const result = solve(puzzle);
    expect(result.solutions).toHaveLength(2);
    expect(result.solutions.every(v => direct(puzzle, v))).toBe(true);
    expect(puzzle.givens).toEqual(original);
    expect(solve(puzzle, puzzle.givens, { maxNodes: 0 })).toMatchObject({ complete: false, nodes: 0, solutions: [] });
    expect(solve(puzzle, puzzle.givens, { maxNodes: 1 }).complete).toBe(false);
  });
  it('полностью перечисляет 11222 поля 6×6 с разрешёнными повторами линий', () => {
    const puzzle = empty(6);
    const result = solve(puzzle, puzzle.givens, { limit: 20000, maxNodes: 50000 });
    expect(result.complete).toBe(true);
    expect(result.solutions).toHaveLength(11222);
    expect(new Set(result.solutions.map(board => board.join(','))).size).toBe(11222);
    expect(result.solutions.every(board => direct(puzzle, board))).toBe(true);
  }, 30000);
  it('отличает заданную клетку, тройку, баланс, связь и геометрию', () => {
    const puzzle = empty(6), board: CellValue[] = Array(36).fill(null);
    puzzle.givens[0] = 'sun';
    expect(validateBoard(puzzle, board).conflicts.some(c => c.rule === 'given')).toBe(true);
    board.splice(0, 4, 'sun', 'sun', 'sun', 'sun');
    puzzle.relations = [{ a: 0, b: 1, type: 'different' }, { a: 5, b: 6, type: 'equal' }];
    const rules = validateBoard(puzzle, board).conflicts.map(c => c.rule);
    expect(rules).toEqual(expect.arrayContaining(['triple', 'balance', 'relation', 'geometry']));
    expect(propagate(puzzle, board).contradiction).toBe(true);
  });
  it('фиксированное правильное поле имеет единственное решение', () => {
    const { puzzle, answer } = fixture(verification.generated_puzzles[0]);
    const filled = { ...puzzle, givens: answer };
    expect(validateBoard(filled, answer)).toMatchObject({ valid: true, complete: true });
    expect(solve(filled)).toMatchObject({ solutions: [answer], complete: true });
  });
  it('отклоняет разреженные массивы условий и поля', () => {
    const puzzle = empty(6);
    const sparse: CellValue[] = Array(36);
    expect(validateBoard(puzzle, sparse).valid).toBe(false);
    expect(propagate(puzzle, sparse).contradiction).toBe(true);
    puzzle.givens = sparse;
    expect(validateBoard(puzzle, Array(36).fill(null)).valid).toBe(false);
  });
  it('защищает каталог от изменений вызывающей стороны', () => {
    const line = getLineCatalog(6); line[0][0] = line[0][0] === 'sun' ? 'moon' : 'sun';
    expect(getLineCatalog(6)[0]).not.toEqual(line[0]);
  });
});

describe('Генерация', () => {
  it.each([6,8,10] as const)('создаёт решаемую логикой задачу %i', n => {
    const puzzle = generatePuzzle({ size: n, seed: 'проверка', maxAttempts: 1 });
    const state = propagate(puzzle, puzzle.givens), solutions = solve(puzzle);
    expect(state.complete).toBe(true);
    expect(solutions.complete).toBe(true);
    expect(solutions.solutions).toHaveLength(1);
    expect(direct(puzzle, solutions.solutions[0])).toBe(true);
    expect(puzzle.givens.filter(v => v === null).length).toBeGreaterThanOrEqual(n*n/2);
    expect(puzzle.relations.length).toBeGreaterThan(0);
    expect(puzzle).not.toHaveProperty('solution');
  }, 30000);
  it.each([6,8,10] as const)('воспроизводит задачу %i по одинаковому seed', size => {
    const options = { size, seed: 'повтор', maxAttempts: 1 };
    expect(generatePuzzle(options)).toEqual(generatePuzzle(options));
  }, 30000);
  it('резервные задачи разных seed разнообразны и проверены', () => {
    const puzzles = Array.from({length: 8}, (_, seed) => generatePuzzle({size: 6, seed, maxAttempts: 0}));
    expect(new Set(puzzles.map(p => JSON.stringify([p.givens, p.relations]))).size).toBeGreaterThan(1);
    for (const puzzle of puzzles) expect(propagate(puzzle, puzzle.givens).complete).toBe(true);
  });
});
