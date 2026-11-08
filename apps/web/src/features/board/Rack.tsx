import { Tile } from '../../components/ui/Tile';

type RackProps = {
  slotCount: number;
};

export function Rack({ slotCount }: RackProps) {
  if (!Number.isInteger(slotCount) || slotCount < 0) {
    throw new Error(`Rack needs a whole number of spaces. Received ${slotCount}.`);
  }

  return (
    <div className="rack" role="group" aria-label={`Empty rack, ${slotCount} spaces`}>
      {Array.from({ length: slotCount }, (_, index) => (
        <Tile key={index} />
      ))}
    </div>
  );
}
