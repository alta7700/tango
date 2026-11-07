import type { BoardSize, CellValue, Puzzle, Relation, SymbolValue } from '../shared/types';
import { certified } from './certified';

const symbols: SymbolValue[] = ['sun', 'moon'];
const catalogCache = new Map<BoardSize, SymbolValue[][]>();

/** Возвращает копию каталога сбалансированных линий без троек. */
export function getLineCatalog(size: BoardSize): SymbolValue[][] {
  if (![6, 8, 10].includes(size)) throw new Error('Неподдерживаемый размер поля');
  if (!catalogCache.has(size)) {
    const lines: SymbolValue[][] = [];
    for (let bits = 0; bits < 2 ** size; bits++) {
      const line = Array.from({ length: size }, (_, i) => symbols[(bits >> i) & 1]);
      if (line.filter(v => v === 'sun').length !== size / 2) continue;
      if (line.some((v, i) => i >= 2 && v === line[i - 1] && v === line[i - 2])) continue;
      lines.push(line);
    }
    catalogCache.set(size, lines);
  }
  return catalogCache.get(size)!.map(line => [...line]);
}

export interface Conflict { cells: number[]; message: string; rule: string }
export interface Validation { valid: boolean; complete: boolean; conflicts: Conflict[] }
const isValue = (v: unknown): v is CellValue => v === null || v === 'sun' || v === 'moon';

/** Проверяет форму условий и непосредственные нарушения правил, не изменяя поле. */
export function validateBoard(puzzle: Puzzle, board: CellValue[]): Validation {
  const conflicts: Conflict[] = [];
  const add = (rule: string, message: string, cells: number[] = []) => conflicts.push({ rule, message, cells });
  if (!puzzle || ![6, 8, 10].includes(puzzle.size) || puzzle.rulesVersion !== 1 || !Array.isArray(puzzle.givens) || !Array.isArray(puzzle.relations)) {
    add('geometry', 'Некорректные условия задачи');
    return { valid: false, complete: false, conflicts };
  }
  const n = puzzle.size, count = n * n;
  if (puzzle.givens.length !== count || !Array.from(puzzle.givens).every(isValue) || !Array.isArray(board) || board.length !== count || !Array.from(board).every(isValue)) {
    add('geometry', 'Некорректная форма поля или значения клеток');
    return { valid: false, complete: false, conflicts };
  }
  const seen = new Map<string, string>();
  for (const edge of puzzle.relations) {
    if (!edge || !Number.isInteger(edge.a) || !Number.isInteger(edge.b) || edge.a < 0 || edge.b < 0 || edge.a >= count || edge.b >= count || !['equal', 'different'].includes(edge.type) || !(Math.abs(edge.a - edge.b) === n || (Math.abs(edge.a - edge.b) === 1 && Math.floor(edge.a / n) === Math.floor(edge.b / n)))) {
      add('geometry', 'Связь должна соединять соседние клетки');
      continue;
    }
    const key = [edge.a, edge.b].sort((a, b) => a - b).join(':');
    if (seen.has(key) && seen.get(key) !== edge.type) add('geometry', 'Несовместимые связи', [edge.a, edge.b]);
    seen.set(key, edge.type);
    if (board[edge.a] !== null && board[edge.b] !== null && ((board[edge.a] === board[edge.b]) !== (edge.type === 'equal'))) add('relation', 'Связь нарушена', [edge.a, edge.b]);
  }
  for (let i = 0; i < count; i++) if (puzzle.givens[i] !== null && board[i] !== puzzle.givens[i]) add('given', 'Заданная клетка изменена', [i]);
  for (let line = 0; line < 2 * n; line++) {
    const cells = Array.from({ length: n }, (_, i) => line < n ? line * n + i : i * n + line - n);
    for (const v of symbols) {
      const filled = cells.filter(i => board[i] === v);
      if (filled.length > n / 2) add('balance', 'Нарушен баланс линии', filled);
    }
    for (let i = 0; i < n - 2; i++) {
      const triple = cells.slice(i, i + 3), value = board[triple[0]];
      if (value !== null && triple.every(k => board[k] === value)) add('triple', 'Три одинаковых символа подряд', triple);
    }
  }
  return { valid: conflicts.length === 0, complete: conflicts.length === 0 && board.every(v => v !== null), conflicts };
}

export interface LineRemoval { line: number; crossing: number; removed: SymbolValue[][]; supported: SymbolValue[] }

/** Результат распространения: строки предшествуют столбцам в lineCandidates. */
export interface Propagation {
  contradiction: boolean; candidates: SymbolValue[][]; complete: boolean; board: CellValue[]; lineCandidates: SymbolValue[][][]; removals: LineRemoval[];
}

/** Согласует каталоги линий и связи до неподвижной точки без перебора. */
export function propagate(puzzle: Puzzle, board: CellValue[]): Propagation {
  const validation = validateBoard(puzzle, board);
  if (!validation.valid) return { contradiction: true, candidates: [], complete: false, board: Array.isArray(board) ? [...board] : [], lineCandidates: [], removals: [] };
  const n = puzzle.size;
  const indices = Array.from({ length: 2 * n }, (_, line) => Array.from({ length: n }, (_, i) => line < n ? line * n + i : i * n + line - n));
  const lines = indices.map(cells => {
    const position = new Map(cells.map((cell, i) => [cell, i]));
    const edges = puzzle.relations.filter(e => position.has(e.a) && position.has(e.b));
    return getLineCatalog(n).filter(line => cells.every((cell, i) => board[cell] === null || board[cell] === line[i]) && edges.every(e => (line[position.get(e.a)!] === line[position.get(e.b)!]) === (e.type === 'equal')));
  });
  const removals: LineRemoval[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const rowSet = new Set(lines[row].map(line => line[col]));
      const colSet = new Set(lines[n + col].map(line => line[row]));
      const a = lines[row].filter(line => colSet.has(line[col]));
      const b = lines[n + col].filter(line => rowSet.has(line[row]));
      if (a.length !== lines[row].length) removals.push({ line: row, crossing: row * n + col, removed: lines[row].filter(line => !colSet.has(line[col])), supported: [...colSet] });
      if (b.length !== lines[n + col].length) removals.push({ line: n + col, crossing: row * n + col, removed: lines[n + col].filter(line => !rowSet.has(line[row])), supported: [...rowSet] });
      if (a.length !== lines[row].length || b.length !== lines[n + col].length) changed = true;
      lines[row] = a; lines[n + col] = b;
    }
  }
  if (lines.some(line => line.length === 0)) return { contradiction: true, candidates: Array.from({length: n*n}, () => []), complete: false, board: [...board], lineCandidates: lines, removals };
  const candidates = Array.from({ length: n*n }, (_, i) => symbols.filter(v => lines[Math.floor(i / n)].some(line => line[i % n] === v) && lines[n + i % n].some(line => line[Math.floor(i / n)] === v)));
  const result = candidates.map(options => options.length === 1 ? options[0] : null);
  return { contradiction: false, candidates, complete: result.every(v => v !== null), board: result, lineCandidates: lines, removals };
}

export interface SolveOptions { limit?: number; maxNodes?: number }
export interface SolveResult { solutions: SymbolValue[][]; complete: boolean; nodes: number }

/** Перебирает варианты наиболее ограниченной линии; неполный обход не доказывает единственность. */
export function solve(puzzle: Puzzle, board: CellValue[] = puzzle.givens, options: SolveOptions = {}): SolveResult {
  const { limit = 2, maxNodes = 100000 } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxNodes) || maxNodes < 0) throw new Error('Некорректный предел поиска');
  const solutions: SymbolValue[][] = [];
  let nodes = 0, complete = true;
  const visit = (current: CellValue[]) => {
    if (solutions.length >= limit) { complete = false; return; }
    if (nodes >= maxNodes) { complete = false; return; }
    nodes++;
    const state = propagate(puzzle, current);
    if (state.contradiction) return;
    if (state.complete) {
      if (validateBoard(puzzle, state.board).complete) solutions.push(state.board as SymbolValue[]);
      return;
    }
    let best = -1;
    for (let i = 0; i < state.lineCandidates.length; i++) if (state.lineCandidates[i].length > 1 && (best < 0 || state.lineCandidates[i].length < state.lineCandidates[best].length)) best = i;
    const n = puzzle.size;
    for (const line of state.lineCandidates[best]) {
      if (solutions.length >= limit || nodes >= maxNodes) { complete = false; break; }
      const next = [...state.board];
      for (let i = 0; i < n; i++) next[best < n ? best * n + i : i * n + best - n] = line[i];
      visit(next);
    }
  };
  visit(board);
  return { solutions, complete, nodes };
}

/** Детальный генератор случайных чисел с воспроизводимым состоянием. */
function randomFromSeed(seed: string): () => number {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

export interface GenerateOptions { size: BoardSize; seed: string | number; maxAttempts?: number }
/** Создаёт проверенную задачу: удаление условий сохраняет полный логический вывод. */
export function generatePuzzle({ size, seed, maxAttempts = 2 }: GenerateOptions): Puzzle {
  if (![6, 8, 10].includes(size) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 0 || (typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed)))) throw new Error('Некорректные параметры генерации');
  const seedText = String(seed), random = randomFromSeed(seedText);
  const base = (): Puzzle => ({ id: `${size}-${seedText}`, size, seed: seedText, rulesVersion: 1, givens: Array(size * size).fill(null), relations: [] });
  // Случайный порядок каталогов обеспечивает разнообразие полных полей.
  const makeField = (): SymbolValue[] | null => {
    let remaining = 5000;
    const visit = (board: CellValue[]): SymbolValue[] | null => {
      if (remaining-- <= 0) return null;
      const state = propagate(base(), board);
      if (state.contradiction) return null;
      if (state.complete) return validateBoard(base(), state.board).complete ? state.board as SymbolValue[] : null;
      const candidates = state.lineCandidates.map((lines, index) => ({ lines, index })).filter(v => v.lines.length > 1);
      const min = Math.min(...candidates.map(v => v.lines.length));
      const selected = shuffle(candidates.filter(v => v.lines.length === min), random)[0];
      for (const line of shuffle(selected.lines, random)) {
        const next = [...state.board];
        line.forEach((value, i) => { next[selected.index < size ? selected.index * size + i : i * size + selected.index - size] = value; });
        const result = visit(next); if (result) return result;
      }
      return null;
    };
    return visit(Array(size * size).fill(null));
  };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const field = makeField(); if (!field) continue;
    const puzzle = base(); puzzle.givens = [...field];
    for (let i = 0; i < field.length; i++) for (const j of [i + 1, i + size]) if (j < field.length && (j !== i + 1 || Math.floor(i / size) === Math.floor(j / size))) puzzle.relations.push({ a: i, b: j, type: field[i] === field[j] ? 'equal' : 'different' });
    const conditions = shuffle([...field.map((_, index) => ({ kind: 'cell' as const, index })), ...puzzle.relations.map((_, index) => ({ kind: 'edge' as const, index }))], random);
    // Полный вывод на каждом шаге сам доказывает единственность: все его сужения
    // сохраняют каждое решение. Финальный точный поиск дополнительно проверяет результат.
    // Индексы связей стабильны: удаление сначала помечается, затем массив уплотняется.
    const edges: (Relation | null)[] = [...puzzle.relations];
    for (const condition of conditions) {
      const old = condition.kind === 'cell' ? puzzle.givens[condition.index] : edges[condition.index];
      if (condition.kind === 'cell') puzzle.givens[condition.index] = null; else edges[condition.index] = null;
      puzzle.relations = edges.filter((e): e is Relation => e !== null);
      if (!propagate(puzzle, puzzle.givens).complete) {
        if (condition.kind === 'cell') puzzle.givens[condition.index] = old as CellValue; else edges[condition.index] = old as Relation;
      }
    }
    puzzle.relations = edges.filter((e): e is Relation => e !== null);
    const check = solve(puzzle, puzzle.givens, { limit: 2, maxNodes: 5000 });
    if (puzzle.givens.filter(v => v === null).length >= size * size / 2 && puzzle.relations.length > 0 && check.complete && check.solutions.length === 1 && propagate(puzzle, puzzle.givens).complete) return puzzle;
  }
  // Резервные задачи заранее проверены; симметрии сохраняют все правила.
  const pool = certified.filter(p => p.size === size), source = pool[Math.floor(random() * pool.length)];
  const flip = random() < .5, rotations = Math.floor(random() * 4), invert = random() < .5;
  const transform = (index: number) => {
    let row = Math.floor(index / size), col = index % size;
    if (flip) col = size - 1 - col;
    for (let i = 0; i < rotations; i++) [row, col] = [col, size - 1 - row];
    return row * size + col;
  };
  const puzzle = base();
  source.givens.forEach((value, i) => { puzzle.givens[transform(i)] = value === null || !invert ? value : value === 'sun' ? 'moon' : 'sun'; });
  puzzle.relations = source.relations.map(edge => ({ a: transform(edge.a), b: transform(edge.b), type: edge.type }));
  const check = solve(puzzle, puzzle.givens, { limit: 2, maxNodes: 5000 });
  if (!check.complete || check.solutions.length !== 1 || !propagate(puzzle, puzzle.givens).complete) throw new Error('Резервная задача не прошла проверку');
  return puzzle;
}
