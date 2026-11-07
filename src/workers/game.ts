import { generatePuzzle } from '../core';
import { getHint } from '../hints';
import type { BoardSize, CellValue, Puzzle } from '../shared/types';

type Request = { id: number; type: 'generate'; size: BoardSize; seed: string } | { id: number; type: 'hint'; puzzle: Puzzle; board: CellValue[] };
// Исключение передаётся вызывающей стороне вместо зависания запроса.
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const result = request.type === 'generate' ? generatePuzzle({ size: request.size, seed: request.seed }) : getHint(request.puzzle, request.board);
    self.postMessage({ id: request.id, result });
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Ошибка обработки' }); }
};
