export interface BoardCell {
  column: number;
  row: number;
}

export interface Level {
  name: string;
  rows: readonly string[];
  width: number;
  height: number;
  start: BoardCell;
  goal: BoardCell;
}

export function makeLevel(name: string, rows: readonly string[]): Level {
  let start: BoardCell | undefined;
  let goal: BoardCell | undefined;

  rows.forEach((line, row) => {
    [...line].forEach((tile, column) => {
      if (tile === 'S') start = { column, row };
      if (tile === 'G') goal = { column, row };
    });
  });

  if (!start || !goal) throw new Error(`Invalid puzzle: ${name}`);
  return { name, rows, width: Math.max(...rows.map((line) => line.length)), height: rows.length, start, goal };
}

export const LEVELS: readonly Level[] = [
  makeLevel('Pierwsze kroki', [
    '..####..',
    '..####..',
    '######..',
    'S####G..',
    '######..',
  ]),
  makeLevel('Mostek przez śnieg', [
    '..######..',
    '..######..',
    '####..####',
    'S###..###G',
    '####..####',
    '..######..',
    '..######..',
  ]),
  makeLevel('Zimowe zaułki', [
    '##########',
    '#######.G#',
    '##..###.##',
    '##..###.##',
    '#....#####',
    '##...#####',
    '##...###..',
    '#S#####...',
    '#######...',
  ]),
  makeLevel('Kręta droga', [
    '##########',
    '########G#',
    '.....###.#',
    '##.......#',
    '##......##',
    '#####...##',
    '##########',
    '#S########',
    '##########',
  ]),
  makeLevel('Ostatni krok', [
    '##########',
    '#####...G#',
    '##...#####',
    '##...#####',
    '#####...##',
    '#####...##',
    '#####...##',
    '#S##...###',
    '####...###',
  ]),
];

export function hasTile(level: Level, column: number, row: number): boolean {
  const tile = level.rows[row]?.[column];
  return tile !== undefined && tile !== '.';
}
