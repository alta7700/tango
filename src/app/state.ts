import { propagate, validateBoard } from '../core';
import type { CellValue, Puzzle } from '../shared/types';

export interface GameState { puzzle: Puzzle; board: CellValue[]; history: CellValue[][]; elapsed: number; number: number }
const isCell = (v: unknown): v is CellValue => v === null || v === 'sun' || v === 'moon';
/** Создаёт состояние новой партии без раскрытия решения. */
export function newState(puzzle: Puzzle, number: number): GameState {
  return { puzzle, board: [...puzzle.givens], history: [], elapsed: 0, number };
}
/** Записывает ход, сохраняя предыдущую позицию для отмены. */
export function move(state: GameState, index: number, value: CellValue): GameState {
  if (state.puzzle.givens[index] !== null || index < 0 || index >= state.board.length || state.board[index] === value) return state;
  const board = [...state.board]; board[index] = value;
  return { ...state, board, history: [...state.history, state.board] };
}
/** Отменяет последний ход; исходные условия не меняются. */
export function undo(state: GameState): GameState {
  if (!state.history.length) return state;
  return { ...state, board: [...state.history[state.history.length - 1]], history: state.history.slice(0, -1) };
}
/** Возвращает поле к условиям той же партии. */
export function reset(state: GameState): GameState {
  return { ...state, board: [...state.puzzle.givens], history: [] };
}
/** Читает только корректные сохранения, допуская ошибки в ходах игрока. */
export function restore(raw: string | null): GameState | null {
  try {
    const data = JSON.parse(raw ?? 'null');
    if (!data || data.version !== 1) return null;
    const s = data.state as GameState, p = s?.puzzle;
    if (!p || typeof p.id !== 'string' || typeof p.seed !== 'string' || ![6, 8, 10].includes(p.size) || p.rulesVersion !== 1 || !Array.isArray(p.givens) || !Array.isArray(p.relations)) return null;
    if (!validateBoard(p, p.givens).valid || !propagate(p, p.givens).complete) return null;
    const validBoard = (b: unknown): b is CellValue[] => Array.isArray(b) && b.length === p.size ** 2 && Array.from(b).every(isCell) && p.givens.every((v, i) => v === null || b[i] === v);
    if (!validBoard(s.board) || !Array.isArray(s.history) || !s.history.every(validBoard) || !Number.isFinite(s.elapsed) || s.elapsed < 0 || !Number.isSafeInteger(s.number) || s.number < 1) return null;
    return s;
  } catch { return null; }
}
