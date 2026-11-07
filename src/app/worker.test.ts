import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePuzzle } from '../core';
import { getHint } from '../hints';
import { GameWorker } from './worker';

const puzzle = generatePuzzle({ size: 6, seed: 'восстановление', maxAttempts: 1 });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('восстановление подсказки', () => {
  it('повторяет транспортную ошибку и использует те же публичные условия', async () => {
    const constructors = vi.fn().mockImplementation(() => { throw new Error('Сеть недоступна'); });
    vi.stubGlobal('Worker', constructors);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const board = [...puzzle.givens];
    const result = await new GameWorker().hint(puzzle, board);
    expect(constructors).toHaveBeenCalledTimes(2);
    expect(result).toEqual(getHint(puzzle, board, { maxNodes: 32 }));
    expect(board).toEqual(puzzle.givens);
  });

  it('сохраняет ошибочный ход и возвращает настоящий конфликт', async () => {
    vi.stubGlobal('Worker', vi.fn().mockImplementation(() => { throw new Error('Сеть недоступна'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const board = [...puzzle.givens];
    board[0] = board[1] = board[2] = 'sun';
    const before = [...board];
    expect((await new GameWorker().hint(puzzle, board)).kind).toBe('conflict');
    expect(board).toEqual(before);
  });

  it('не скрывает ошибку вычисления повтором или запасным вариантом', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const constructors = vi.fn().mockImplementation(function () {
      return { postMessage(this: { onmessage: (event: unknown) => void }, data: { id: number }) { queueMicrotask(() => this.onmessage({ data: { id: data.id, error: 'Ошибка расчёта' } })); }, terminate() {} };
    });
    vi.stubGlobal('Worker', constructors);
    await expect(new GameWorker().hint(puzzle, [...puzzle.givens])).rejects.toThrow('Ошибка расчёта');
    expect(constructors).toHaveBeenCalledTimes(1);
  });

  it('не запускает запасной расчёт после закрытия', async () => {
    const instance = new GameWorker();
    instance.dispose();
    await expect(instance.hint(puzzle, [...puzzle.givens])).rejects.toThrow('Обработчик закрыт');
  });
});
