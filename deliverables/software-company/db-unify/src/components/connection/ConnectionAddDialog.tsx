import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ConnectionForm from './ConnectionForm';
import type { DbConnection } from '../../types/connection';
import { useConnectionStore } from '../../stores/connectionStore';

interface ConnectionAddDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Pre-filled connection name (typically the tree node name) */
  defaultName?: string;
  /** Close handler */
  onClose: () => void;
}

/**
 * Dialog wrapper for adding a new database connection.
 * Reuses ConnectionForm internally and pre-fills the name field
 * with the tree node name (e.g. "兰山区").
 */
const ConnectionAddDialog: React.FC<ConnectionAddDialogProps> = ({
  open,
  defaultName = '',
  onClose,
}) => {
  const addConnection = useConnectionStore((s) => s.addConnection);

  // Use a key that increments when the dialog opens to force
  // re-mount of ConnectionForm, ensuring defaultName is applied.
  const [formKey, setFormKey] = useState(0);

  React.useEffect(() => {
    if (open) {
      setFormKey((prev) => prev + 1);
    }
  }, [open]);

  const handleSave = (data: Omit<DbConnection, 'id'>) => {
    addConnection(data);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2, maxWidth: 360 },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        新增连接
        <IconButton size="small" onClick={onClose} sx={{ ml: 1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <ConnectionForm
          key={formKey}
          defaultName={defaultName}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ConnectionAddDialog;
