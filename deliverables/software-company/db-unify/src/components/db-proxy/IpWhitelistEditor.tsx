import React, { useState } from 'react';
import { Box, Chip, TextField, Typography } from '@mui/material';

interface Props {
  value: string[];
  onChange: (ips: string[]) => void;
  label?: string;
  disabled?: boolean;
}

/** 校验单个 IP 或 CIDR 网段 */
export function isValidIpOrCidr(entry: string): boolean {
  const t = entry.trim();
  if (!t) return false;
  // 网段 10.0.0.0/24 或 10.0.0.1/32
  const cidr = t.match(/^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/);
  if (cidr) {
    const parts = t.split('/');
    const octets = parts[0].split('.').map(Number);
    const prefix = Number(parts[1]);
    const okOctets = octets.every((o) => o >= 0 && o <= 255);
    return okOctets && prefix >= 0 && prefix <= 32;
  }
  // 单个 IPv4
  const octets = t.split('.').map(Number);
  return octets.length === 4 && octets.every((o) => o >= 0 && o <= 255);
}

/**
 * IP 白名单编辑器：支持多 IP/网段，逗号/换行分隔，chip 增删，格式校验。
 */
const IpWhitelistEditor: React.FC<Props> = ({ value, onChange, label, disabled }) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addEntries = (raw: string) => {
    const entries = raw
      .split(/[\n,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!entries.length) return;
    const invalid = entries.filter((e) => !isValidIpOrCidr(e));
    if (invalid.length) {
      setError(`格式无效: ${invalid.join('、')}`);
      return;
    }
    setError(null);
    const merged = [...new Set([...value, ...entries])];
    onChange(merged);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEntries(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const removeIp = (ip: string) => onChange(value.filter((v) => v !== ip));

  return (
    <Box>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.7rem', mb: 0.5 }}>
        {label || '来源 IP 白名单（支持多个 IP 或网段，回车/逗号添加，留空不限制）'}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
        {value.length === 0 && (
          <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem' }}>不限制</Typography>
        )}
        {value.map((ip) => (
          <Chip
            key={ip}
            size="small"
            label={ip}
            onDelete={disabled ? undefined : () => removeIp(ip)}
            sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'action.hover', color: 'text.primary' }}
          />
        ))}
      </Box>
      {!disabled && (
        <TextField
          fullWidth
          size="small"
          placeholder="输入 IP 或网段，回车添加，如 192.168.1.0/24"
          value={input}
          disabled={disabled}
          onChange={(e) => { setInput(e.target.value); if (error) setError(null); }}
          onKeyDown={handleKeyDown}
          onBlur={() => addEntries(input)}
          error={!!error}
          helperText={error}
          sx={{
            '& .MuiInputBase-root': { fontSize: '0.7rem' },
            '& .MuiFormHelperText-root': { fontSize: '0.6rem' },
          }}
        />
      )}
    </Box>
  );
};

export default IpWhitelistEditor;
