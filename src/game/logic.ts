import { hasTile, type BoardCell, type Level } from './levels';

export type Direction = 'up' | 'right' | 'down' | 'left';
export type BlockAxis = 'upright' | 'column' | 'row';

export interface BlockPosition extends BoardCell {
  axis: BlockAxis;
}

export interface MoveResult {
  position: BlockPosition;
  bridgesOpen: boolean;
  switchPressed: boolean;
  supported: boolean;
}

export interface DirectionDelta {
  column: number;
  row: number;
}

export const DIRECTION_DELTAS: Record<Direction, DirectionDelta> = {
  up: { column: -1, row: 0 },
  right: { column: 0, row: -1 },
  down: { column: 1, row: 0 },
  left: { column: 0, row: 1 },
};

export function startingPosition(level: Level): BlockPosition {
  return { ...level.start, axis: 'upright' };
}

export function roll(position: BlockPosition, direction: Direction): BlockPosition {
  const { column, row, axis } = position;
  const delta = DIRECTION_DELTAS[direction];

  if (axis === 'upright') {
    if (delta.column !== 0) {
      return { column: column + (delta.column > 0 ? 1 : -2), row, axis: 'column' };
    }
    return { column, row: row + (delta.row > 0 ? 1 : -2), axis: 'row' };
  }

  if (axis === 'column' && delta.column !== 0) {
    return { column: column + (delta.column > 0 ? 2 : -1), row, axis: 'upright' };
  }
  if (axis === 'row' && delta.row !== 0) {
    return { column, row: row + (delta.row > 0 ? 2 : -1), axis: 'upright' };
  }
  return { column: column + delta.column, row: row + delta.row, axis };
}

export function occupiedCells(position: BlockPosition): BoardCell[] {
  const cells = [{ column: position.column, row: position.row }];
  if (position.axis === 'column') cells.push({ column: position.column + 1, row: position.row });
  if (position.axis === 'row') cells.push({ column: position.column, row: position.row + 1 });
  return cells;
}

export function isSupported(level: Level, position: BlockPosition, bridgesOpen = false): boolean {
  return occupiedCells(position).every(({ column, row }) => hasTile(level, column, row, bridgesOpen));
}

export function moveBlock(level: Level, position: BlockPosition, direction: Direction, bridgesOpen: boolean): MoveResult {
  const destination = roll(position, direction);
  if (!isSupported(level, destination, bridgesOpen)) {
    return { position: destination, bridgesOpen, switchPressed: false, supported: false };
  }

  const switchPressed = destination.axis === 'upright' && level.rows[destination.row]?.[destination.column] === 'T';
  const nextBridgesOpen = switchPressed ? !bridgesOpen : bridgesOpen;
  return {
    position: destination,
    bridgesOpen: nextBridgesOpen,
    switchPressed,
    supported: isSupported(level, destination, nextBridgesOpen),
  };
}

export function isGoal(level: Level, position: BlockPosition): boolean {
  return position.axis === 'upright' && position.column === level.goal.column && position.row === level.goal.row;
}
