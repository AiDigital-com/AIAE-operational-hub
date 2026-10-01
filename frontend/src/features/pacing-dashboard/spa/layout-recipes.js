// Explicit authoring recipes only: opening an old saved block never rewrites it.
// The caller supplies container/node IDs using its existing composition allocator.
export function layoutRecipe(type) {
  if (type !== 'flightBullet') return null;
  return {
    title: 'Flight',
    gap: 'tight',
    bricks: [
      { type: 'note', source: 'flightPosition', align: 'start', style: 'headline' },
      { type: 'progressBar', bind: { reading: 'flight.day' }, target: { reading: 'flight.total' }, invert: false, tone: 'neutral', size: 'compact' },
      { type: 'note', source: 'flightRemaining', align: 'start', style: 'caption' },
    ],
  };
}
