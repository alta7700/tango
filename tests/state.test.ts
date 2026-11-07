import { describe, expect, it } from 'vitest';
import { generatePuzzle } from '../src/core';
import { move, newState, reset, restore, undo } from '../src/app/state';

const puzzle = generatePuzzle({ size: 6, seed: 'state-test', maxAttempts: 0 });
const encode = (state: unknown) => JSON.stringify({ version: 1, state });
describe('состояние партии', () => {
  it('восстанавливает ошибочный ход и позволяет его отменить', () => {
    const state = newState(puzzle, 4);
    // Заполняем свободные клетки одним символом, намеренно нарушая баланс.
    let current = state;
    puzzle.givens.forEach((value, i) => { if (value === null) current = move(current, i, 'sun'); });
    const restored = restore(encode(current));
    expect(restored).not.toBeNull();
    expect(restored!.board).toEqual(current.board);
    expect(undo(restored!).board).toEqual(current.history.at(-1));
  });
  it('сохраняет заданные клетки и номер при отмене и сбросе', () => {
    const state = newState(puzzle, 7), given = puzzle.givens.findIndex(v => v !== null), empty = puzzle.givens.indexOf(null);
    expect(move(state, given, null)).toBe(state);
    const changed = move(state, empty, 'sun');
    expect(undo(changed).board).toEqual(puzzle.givens);
    expect(reset(changed).board).toEqual(puzzle.givens);
    expect(reset(changed).number).toBe(7);
    expect(restore(encode(changed))?.number).toBe(7);
  });
  it('отклоняет повреждённые данные и изменения заданных клеток', () => {
    const state = newState(puzzle, 1), given = puzzle.givens.findIndex(v => v !== null);
    state.board[given] = null;
    expect(restore(encode(state))).toBeNull();
    expect(restore('{')).toBeNull();
    expect(restore(JSON.stringify({ version: 2, state }))).toBeNull();
  });
});
