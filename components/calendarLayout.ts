import { spacing } from '../theme';

const COLUMN_COUNT = 7;
const GRID_MAX_WIDTH = 1200;
const GRID_BORDER_WIDTH = 2;

export const MIN_TOUCH_TARGET = 44;

type Insets = {
  left?: number;
  right?: number;
};

export function getCalendarLayout(width: number, insets: Insets = {}) {
  const compact = width < 480;
  const outerHorizontalPadding = compact ? spacing[1] : spacing[4];
  const framePadding = compact ? spacing[1] : spacing[3];
  const gap = compact ? 2 : spacing[2];

  const paddingLeft = Math.max(
    outerHorizontalPadding,
    (insets.left ?? 0) + (compact ? spacing[1] : 0)
  );
  const paddingRight = Math.max(
    outerHorizontalPadding,
    (insets.right ?? 0) + (compact ? spacing[1] : 0)
  );

  const frameWidth = Math.min(
    Math.max(width - paddingLeft - paddingRight, 0),
    GRID_MAX_WIDTH
  );
  const availableGridWidth = Math.max(
    frameWidth - framePadding * 2 - GRID_BORDER_WIDTH,
    0
  );
  const minGridWidth = MIN_TOUCH_TARGET * COLUMN_COUNT + gap * (COLUMN_COUNT - 1);
  const gridWidth = Math.max(minGridWidth, availableGridWidth);
  const cellWidth = (gridWidth - gap * (COLUMN_COUNT - 1)) / COLUMN_COUNT;

  return {
    compact,
    cellHeight: compact ? 56 : 100,
    cellWidth,
    framePadding,
    gap,
    gridWidth,
    isScrollable: gridWidth > availableGridWidth + 1,
    paddingLeft,
    paddingRight,
  };
}
