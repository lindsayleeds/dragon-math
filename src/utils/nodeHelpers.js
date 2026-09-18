export const NODE_STATE = {
  LOCKED: 'locked',
  AVAILABLE: 'available',
  COMPLETED: 'completed',
};

/**
 * Derive the visual/interactive state of a node given the player's current position and progress.
 */
export function deriveNodeState(nodeId, currentNodeId, progressMap) {
  if (progressMap[nodeId]?.completed) return NODE_STATE.COMPLETED;
  if (nodeId === currentNodeId) return NODE_STATE.AVAILABLE;
  if (nodeId < currentNodeId) return NODE_STATE.COMPLETED;
  return NODE_STATE.LOCKED;
}
