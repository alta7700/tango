/** Поддерживаемая сторона квадратного поля. */
export type BoardSize = 6 | 8 | 10;
/** Символ в заполненной клетке. */
export type SymbolValue = 'sun' | 'moon';
/** Содержимое клетки, включая пустоту. */
export type CellValue = SymbolValue | null;

/** Связь соседних клеток; индексы идут построчно от нуля. */
export interface Relation {
  a: number;
  b: number;
  type: 'equal' | 'different';
}

/** Публичные условия задачи без сохранённой матрицы решения. */
export interface Puzzle {
  id: string;
  size: BoardSize;
  givens: CellValue[];
  relations: Relation[];
  seed: string;
  rulesVersion: 1;
}

/** Результат объяснимого поиска подсказки по публичным условиям. */
export type HintResult =
  | { kind: 'step'; index: number; value: SymbolValue; rule: string; message: string; relatedCells: number[]; relatedRelations?: number[] }
  | { kind: 'conflict'; message: string; relatedCells: number[] }
  | { kind: 'stuck'; message: string }
  | { kind: 'complete'; message: string };
