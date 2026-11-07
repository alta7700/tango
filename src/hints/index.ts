import { getLineCatalog, propagate, solve, validateBoard } from '../core';
import type { CellValue, HintResult, Puzzle, SymbolValue } from '../shared/types';

const opposite = (value: SymbolValue): SymbolValue => value === 'sun' ? 'moon' : 'sun';
const name = (value: SymbolValue): string => value === 'sun' ? 'солнце' : 'луну';

/** Находит один доказанный ход или объясняет, почему его нельзя предложить. */
export function getHint(puzzle: Puzzle, board: CellValue[], options: { maxNodes?: number } = {}): HintResult {
  const validation = validateBoard(puzzle, board);
  if (!validation.valid) {
    return { kind: 'conflict', message: validation.conflicts[0]?.message ?? 'Условия противоречат заполнению.', relatedCells: [...new Set(validation.conflicts.flatMap(c => c.cells))] };
  }
  // Наличие продолжения необходимо доказать до любого положительного вывода.
  const existence = solve(puzzle, board, { limit: 1, ...options });
  if (!existence.solutions.length) {
    if (!existence.complete) return { kind: 'stuck', message: 'Не удалось проверить существование продолжения в пределах поиска.' };
    return { kind: 'conflict', message: 'Заполненные клетки и связи вместе не допускают продолжения.', relatedCells: board.flatMap((v, i) => v === null ? [] : [i]) };
  }
  if (validation.complete) return { kind: 'complete', message: 'Поле заполнено и все правила соблюдены.' };
  const n = puzzle.size;
  const step = (index: number, value: SymbolValue, rule: string, message: string, relatedCells: number[], relatedRelations?: number[]): HintResult => ({ kind: 'step', index, value, rule, message, relatedCells, ...(relatedRelations?.length ? { relatedRelations } : {}) });
  for (let ri = 0; ri < puzzle.relations.length; ri++) {
    const r = puzzle.relations[ri];
    for (const [source, target] of [[r.a, r.b], [r.b, r.a]]) {
      const value = board[source];
      if (value !== null && board[target] === null) {
        const next = r.type === 'equal' ? value : opposite(value);
        return step(target, next, 'relation', `Связь ${r.type === 'equal' ? '=' : '×'} требует поставить здесь ${name(next)}.`, [source, target], [ri]);
      }
    }
  }
  const lines = Array.from({ length: 2 * n }, (_, l) => Array.from({ length: n }, (_, i) => l < n ? l * n + i : i * n + l - n));
  // Сначала закрываем двойки и промежутки, затем используем баланс.
  for (const line of lines) for (let i = 0; i <= n - 3; i++) {
    const cells = line.slice(i, i + 3);
    for (let empty = 0; empty < 3; empty++) {
      const other = cells.filter((_, k) => k !== empty);
      const value = board[other[0]];
      if (board[cells[empty]] === null && value !== null && value === board[other[1]]) {
        const next = opposite(value);
        return step(cells[empty], next, 'no-three', `Чтобы не получить три одинаковых символа подряд, поставьте ${name(next)}.`, cells);
      }
    }
  }
  for (const line of lines) for (const value of ['sun', 'moon'] as const) {
    if (line.filter(i => board[i] === value).length === n / 2) {
      const target = line.find(i => board[i] === null);
      if (target !== undefined) {
        const next = opposite(value);
        return step(target, next, 'balance', `В линии уже набрана половина символов одного вида; остальные клетки содержат ${name(next)}.`, line.filter(i => board[i] === value || i === target));
      }
    }
  }
  const result = propagate(puzzle, board);
  // Восстанавливаем исходные домены: след ядра описывает только последующие исключения.
  const domains = lines.map(cells => {
    const positions = new Map(cells.map((cell, i) => [cell, i]));
    const edges = puzzle.relations.filter(r => positions.has(r.a) && positions.has(r.b));
    return getLineCatalog(puzzle.size).filter(line => cells.every((cell, i) => board[cell] === null || board[cell] === line[i]) && edges.every(r => (line[positions.get(r.a)!] === line[positions.get(r.b)!]) === (r.type === 'equal')));
  });
  const lineName = (line: number) => line < n ? `строки ${line + 1}` : `столбца ${line - n + 1}`;
  const details = ['Исходные варианты каждой линии соблюдают заполненные клетки, баланс, запрет троек и связи внутри линии.'];
  // Проверяем начальное состояние и каждый префикс следа, останавливаясь на первом выводе.
  const forced = (): { index: number; value: SymbolValue } | undefined => {
    for (let index = 0; index < board.length; index++) {
      if (board[index] !== null) continue;
      const row = Math.floor(index / n), col = index % n;
      const values = (['sun', 'moon'] as const).filter(v => domains[row].some(line => line[col] === v) && domains[n + col].some(line => line[row] === v));
      if (values.length === 1) return { index, value: values[0] };
    }
    return undefined;
  };
  let found = forced();
  for (const removal of result.removals) {
    if (found) break;
    const removed = new Set(removal.removed.map(line => line.join(',')));
    domains[removal.line] = domains[removal.line].filter(line => !removed.has(line.join(',')));
    const row = Math.floor(removal.crossing / n), col = removal.crossing % n;
    details.push(`В пересечении строки ${row + 1} и столбца ${col + 1} из ${lineName(removal.line)} исключено вариантов: ${removal.removed.length}; другая линия допускает ${removal.supported.map(name).join(' или ')}.`);
    found = forced();
  }
  if (found) {
    const { index, value } = found;
    const row = Math.floor(index / n), col = index % n;
    details.push(`В строке ${row + 1} осталось вариантов: ${domains[row].length}, в столбце ${col + 1}: ${domains[n + col].length}; в этой клетке все согласованные варианты требуют поставить ${name(value)}.`);
    return { kind: 'step', index, value, rule: 'line-candidates', message: `В пересечении строки ${row + 1} и столбца ${col + 1} можно поставить только ${name(value)}.`, relatedCells: board.flatMap((v, i) => v === null && i !== index ? [] : [i]), relatedRelations: puzzle.relations.map((_, i) => i), details };
  }
  return { kind: 'stuck', message: 'Применяемые правила пока не дают доказанного хода.' };
}

/** Последовательно применяет доказанные подсказки, сохраняя исходное поле. */
export function solveLogically(puzzle: Puzzle, board: CellValue[] = puzzle.givens): { solved: boolean; board: CellValue[]; steps: HintResult[] } {
  const current = [...board];
  const steps: HintResult[] = [];
  for (let i = 0; i <= puzzle.size ** 2; i++) {
    const hint = getHint(puzzle, current);
    if (hint.kind !== 'step') return { solved: hint.kind === 'complete', board: current, steps };
    steps.push(hint);
    current[hint.index] = hint.value;
  }
  return { solved: false, board: current, steps };
}
