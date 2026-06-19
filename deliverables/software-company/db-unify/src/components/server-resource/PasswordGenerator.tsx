import React, { useState } from 'react';
import {
  Box, Slider, FormControlLabel, Checkbox, TextField, Button,
  Typography, Chip, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import type { PasswordGenConfig } from '../../types/server';
import { generatePassword, getPasswordStrength, DEFAULT_PASSWORD_CONFIG } from '../../utils/passwordUtils';

interface Props {
  open: boolean;
  onApply: (password: string) => void;
  onClose: () => void;
}

const PasswordGenerator: React.FC<Props> = ({ open, onApply, onClose }) => {
  const [config, setConfig] = useState<PasswordGenConfig>({ ...DEFAULT_PASSWORD_CONFIG });
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_PASSWORD_CONFIG));
  const [copied, setCopied] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const strength = getPasswordStrength(password);

  const handleGenerate = () => {
    setPassword(generatePassword(config));
    setCopied(false);
    setShowPwd(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    onApply(password);
    // 重置状态
    setShowPwd(false);
    setCopied(false);
    setPassword(generatePassword(DEFAULT_PASSWORD_CONFIG));
    setConfig({ ...DEFAULT_PASSWORD_CONFIG });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>随机密码生成器</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TextField
            fullWidth size="small"
            type={showPwd ? 'text' : 'password'}
            value={password}
            inputProps={{ readOnly: true, style: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />
          <Tooltip title={showPwd ? '隐藏密码' : '显示密码'}>
            <IconButton size="small" onClick={() => setShowPwd(!showPwd)}>
              {showPwd ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? '已复制' : '复制密码'}>
            <IconButton size="small" onClick={handleCopy}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="重新生成">
            <IconButton size="small" onClick={handleGenerate}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Chip label={strength.label} size="small"
            sx={{ bgcolor: strength.color, color: 'white', fontWeight: 600, fontSize: '0.7rem', height: 22 }} />
          <Typography variant="caption" color="text.secondary">长度: {config.length}</Typography>
        </Box>

        <Box sx={{ px: 1, mb: 2 }}>
          <Slider
            size="small" min={8} max={32} step={2}
            value={config.length}
            onChange={(_, v) => setConfig({ ...config, length: v as number })}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={config.uppercase} onChange={e => setConfig({ ...config, uppercase: e.target.checked })} />}
            label={<Typography variant="caption">A-Z</Typography>}
            sx={{ mr: 1 }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={config.lowercase} onChange={e => setConfig({ ...config, lowercase: e.target.checked })} />}
            label={<Typography variant="caption">a-z</Typography>}
            sx={{ mr: 1 }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={config.numbers} onChange={e => setConfig({ ...config, numbers: e.target.checked })} />}
            label={<Typography variant="caption">0-9</Typography>}
            sx={{ mr: 1 }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={config.symbols} onChange={e => setConfig({ ...config, symbols: e.target.checked })} />}
            label={<Typography variant="caption">!@#</Typography>}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>取消</Button>
        <Button size="small" variant="contained" onClick={handleApply}>使用此密码</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PasswordGenerator;
