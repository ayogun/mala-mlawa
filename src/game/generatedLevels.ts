import { BRIDGE_LEVELS, LEVELS, makeLevel, type BoardCell, type Level } from './levels';
import { isSupported, occupiedCells, roll, type BlockPosition, type Direction } from './logic';

const WIDTH = 10;
const HEIGHT = 9;
const MINIMUM_MOVES = 18;
const MAX_ATTEMPTS = 120;
const BRIDGE_INTERVAL = 5;
const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];
const LEVEL_NAMES = [
  'Śnieżny szlak', 'Lodowa wyprawa', 'Zimowy labirynt', 'Leśne zakręty',
  'Biała ścieżka', 'Gwiezdna noc', 'Ślady na śniegu', 'Mroźna przygoda',
  'Droga przez las', 'Zimowa wędrówka', 'Śnieżna zagadka', 'Szlak liska',
];

interface SearchPosition extends BlockPosition {
  distance: number;
}

interface Candidate {
  rows: string[];
  distance: number;
}

type Random = () => number;

function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function positionKey(position: BlockPosition): string {
  return `${position.column},${position.row},${position.axis}`;
}

function cellKey(cell: BoardCell): string {
  return `${cell.column},${cell.row}`;
}

function randomCandidate(random: Random, targetMoves: number): Candidate | null {
  const tiles = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill('#'));
  const holes = 8 + Math.floor(random() * 8);
  for (let hole = 0; hole < holes; hole += 1) {
    const column = Math.floor(random() * WIDTH);
    const row = Math.floor(random() * HEIGHT);
    const holeWidth = 1 + Math.floor(random() * 3);
    const holeHeight = 1 + Math.floor(random() * 3);
    for (let holeRow = row; holeRow < Math.min(HEIGHT, row + holeHeight); holeRow += 1) {
      for (let holeColumn = column; holeColumn < Math.min(WIDTH, column + holeWidth); holeColumn += 1) {
        tiles[holeRow][holeColumn] = '.';
      }
    }
  }

  const start = { column: 1 + Math.floor(random() * 2), row: 6 + Math.floor(random() * 2) };
  tiles[start.row][start.column] = '#';
  const board: Level = {
    name: '', rows: tiles.map((row) => row.join('')), width: WIDTH, height: HEIGHT, start, goal: start,
  };
  const positions: SearchPosition[] = [{ ...start, axis: 'upright', distance: 0 }];
  const visited = new Set([positionKey(positions[0])]);
  const reachableCells = new Set<string>();

  for (let cursor = 0; cursor < positions.length; cursor += 1) {
    const position = positions[cursor];
    occupiedCells(position).forEach((cell) => reachableCells.add(cellKey(cell)));
    for (const direction of DIRECTIONS) {
      const next = roll(position, direction);
      const key = positionKey(next);
      if (!visited.has(key) && isSupported(board, next)) {
        visited.add(key);
        positions.push({ ...next, distance: position.distance + 1 });
      }
    }
  }

  const goals = positions.filter((position) => position.axis === 'upright'
    && Math.abs(position.column - start.column) + Math.abs(position.row - start.row) >= 5);
  if (reachableCells.size < 30 || goals.length === 0) return null;

  const challengingGoals = goals.filter((position) => position.distance >= targetMoves);
  const goal = challengingGoals.length > 0
    ? challengingGoals[Math.floor(random() * challengingGoals.length)]
    : goals.reduce((furthest, position) => position.distance > furthest.distance ? position : furthest);
  const rows = board.rows.map((line, row) => [...line].map((_, column) => {
    if (column === start.column && row === start.row) return 'S';
    if (column === goal.column && row === goal.row) return 'G';
    return reachableCells.has(cellKey({ column, row })) ? '#' : '.';
  }).join(''));

  return { rows, distance: goal.distance };
}

function transformRows(rows: readonly string[], random: Random): string[] {
  let tiles = rows.map((row) => [...row]);
  if (random() < 0.5) tiles = tiles.map((row) => row.reverse());
  if (random() < 0.5) tiles.reverse();
  if (random() < 0.5) tiles = tiles[0].map((_, column) => tiles.map((row) => row[column]));
  return tiles.map((row) => row.join(''));
}

function bridgeTemplate(index: number): Level | undefined {
  const offset = index - LEVELS.length;
  if (offset < 0 || offset % BRIDGE_INTERVAL !== 0) return undefined;
  return BRIDGE_LEVELS[Math.floor(offset / BRIDGE_INTERVAL) % BRIDGE_LEVELS.length];
}

export function getLevelName(index: number): string {
  return LEVELS[index]?.name ?? bridgeTemplate(index)?.name ?? LEVEL_NAMES[(index - LEVELS.length) % LEVEL_NAMES.length];
}

export function getLevel(index: number): Level {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Invalid level index');
  if (index < LEVELS.length) return LEVELS[index];

  const random = seededRandom(Math.imul(index + 1, 0x9e3779b9));
  const bridge = bridgeTemplate(index);
  if (bridge) return makeLevel(bridge.name, transformRows(bridge.rows, random));
  const targetMoves = 20 + Math.min(2, Math.floor((index - LEVELS.length) / 10));
  let best: Candidate | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomCandidate(random, targetMoves);
    if (candidate && (!best || candidate.distance > best.distance)) best = candidate;
    if (candidate && candidate.distance >= targetMoves) break;
  }

  const rows = best && best.distance >= MINIMUM_MOVES ? best.rows : LEVELS[LEVELS.length - 1].rows;
  return makeLevel(getLevelName(index), transformRows(rows, random));
}
