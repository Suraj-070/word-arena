/**
 * Visual frame for the empty table.
 * The board and rack read these numbers. They do not assume an edge length.
 * Bonus coordinates are absent: none have been designed.
 */
export type BoardFrame = {
  readonly boardSize: number;
  readonly rackSize: number;
};

export const sampleBoardFrame: BoardFrame = {
  boardSize: 15,
  rackSize: 7,
};
