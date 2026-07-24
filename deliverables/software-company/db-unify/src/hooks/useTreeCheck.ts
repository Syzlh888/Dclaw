import { useCallback } from 'react';
import { useTreeStore } from '../stores/treeStore';
import { useEditorStore } from '../stores/editorStore';
import { CheckState } from '../types/tree';

/**
 * Hook that encapsulates tree check logic.
 * Provides a handleCheck function that performs broadcast + bubble
 * and syncs the resulting selectedDbIds to the active tab's binding.
 */
export function useTreeCheck() {
  const toggleCheck = useTreeStore((s) => s.toggleCheck);

  const handleCheck = useCallback(
    (nodeId: string) => {
      toggleCheck(nodeId);
      // After tree state updates, sync the result to the current tab's db binding
      const selectedDbIds = useTreeStore.getState().selectedDbIds;
      const activeTabId = useEditorStore.getState().activeTabId;
      useEditorStore.getState().setTabDbIds(activeTabId, selectedDbIds);
    },
    [toggleCheck]
  );

  return { handleCheck };
}
