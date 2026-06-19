import { useCallback } from 'react';
import { useTreeStore } from '../stores/treeStore';
import { CheckState } from '../types/tree';

/**
 * Hook that encapsulates tree check logic.
 * Provides a handleCheck function that performs broadcast + bubble.
 */
export function useTreeCheck() {
  const toggleCheck = useTreeStore((s) => s.toggleCheck);

  const handleCheck = useCallback(
    (nodeId: string) => {
      toggleCheck(nodeId);
    },
    [toggleCheck]
  );

  return { handleCheck };
}
