import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SxProps, Theme } from '@mui/material';

/** 单个右键菜单项定义 */
export interface ContextMenuItemDef {
  /** 菜单项标签 */
  label: string;
  /** 可选的图标元素 */
  icon?: React.ReactNode;
  /** 点击回调（仅在无 children 时生效） */
  onClick?: () => void;
  /** 红色警告色（如删除操作） */
  danger?: boolean;
  /** 在该项之前绘制分隔线 */
  divider?: boolean;
  /** 是否禁用该项 */
  disabled?: boolean;
  /** 子菜单项（存在时 onClick 被忽略，右侧显示 ▶） */
  children?: ContextMenuItemDef[];
}

export interface ContextMenuProps {
  /** 菜单锚点坐标（null 表示关闭） */
  anchorPosition: { left: number; top: number } | null;
  /** 关闭菜单回调 */
  onClose: () => void;
  /** 菜单项列表 */
  items: ContextMenuItemDef[];
  /** MUI sx 覆盖 */
  sx?: SxProps<Theme>;
}

/**
 * 通用右键菜单组件（支持一级子菜单，hover 展开）
 *
 * 定位: anchorReference="anchorPosition" 指向鼠标坐标；子菜单锚定父项 DOM。
 * 关闭时机: 点击叶子项 / 点击外部 / 按 Esc。
 * 主题自适应 bg background.paper，边框 divider。图标默认 13px、左对齐。
 */
const ContextMenu: React.FC<ContextMenuProps> = ({
  anchorPosition,
  onClose,
  items,
  sx,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  /** 当前打开的子菜单: {index, anchorEl} */
  const [openSub, setOpenSub] = useState<{ index: number; anchorEl: HTMLElement } | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // 主菜单关闭时同步关闭子菜单
  useEffect(() => {
    if (anchorPosition === null) {
      setOpenSub(null);
      clearCloseTimer();
    }
  }, [anchorPosition]);

  // Esc 键关闭（子菜单开则先关子菜单）
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && anchorPosition) {
        if (openSub) setOpenSub(null);
        else onClose();
      }
    },
    [anchorPosition, onClose, openSub],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleItemClick = useCallback(
    (item: ContextMenuItemDef) => {
      if (item.children && item.children.length > 0) return; // 有子菜单：点击不触发
      item.onClick?.();
      onClose();
    },
    [onClose],
  );

  const handleSubItemClick = useCallback(
    (item: ContextMenuItemDef) => {
      item.onClick?.();
      onClose();
    },
    [onClose],
  );

  /** 鼠标进入某菜单项：如果有子菜单则打开，否则关闭已打开的子菜单 */
  const handleItemMouseEnter = (e: React.MouseEvent<HTMLLIElement>, idx: number, item: ContextMenuItemDef) => {
    clearCloseTimer();
    if (item.children && item.children.length > 0) {
      setOpenSub({ index: idx, anchorEl: e.currentTarget });
    } else {
      // 悬停到无子菜单的项 → 略延时关闭子菜单，避免斜线穿越子菜单时误关
      closeTimerRef.current = window.setTimeout(() => setOpenSub(null), 120);
    }
  };

  // 过滤掉纯分隔线项（没有 label 的 divider）
  const visibleItems = items.filter(
    (item) => item.label !== '' || !item.divider,
  );

  /** MenuItem 通用样式（紧凑设计） */
  const itemSx = (danger?: boolean): SxProps<Theme> => ({
    mx: 0.25,
    borderRadius: 0.5,
    py: 0.15,
    minHeight: 22,
    fontSize: '0.68rem',
    color: danger ? '#f87171' : 'text.primary',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    '&:hover': {
      bgcolor: danger ? 'rgba(248, 113, 113, 0.12)' : 'action.selected',
    },
    '& .MuiListItemIcon-root': {
      minWidth: '18px !important',
      color: danger ? '#f87171' : 'text.secondary',
      justifyContent: 'flex-start',
    },
    // 统一强制图标字号 11px（紧凑）
    '& .MuiListItemIcon-root .MuiSvgIcon-root': {
      fontSize: '11px !important',
    },
    '& .MuiListItemText-primary': {
      fontSize: '0.68rem',
      textAlign: 'left',
    },
    '&.Mui-disabled': { opacity: 0.4 },
  });

  const paperSx = {
    minWidth: 130,
    maxWidth: 220,
    bgcolor: 'background.paper',
    border: '1px solid', borderColor: 'divider',
    borderRadius: 1,
    boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
    py: 0.25,
    '& .MuiList-root': { py: 0 },
  };

  // 子菜单更窄
  const subPaperSx = {
    ...paperSx,
    minWidth: 120,
    maxWidth: 200,
  };

  return (
    <>
      <Menu
        ref={menuRef}
        open={anchorPosition !== null}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={
          anchorPosition
            ? { left: anchorPosition.left, top: anchorPosition.top }
            : undefined
        }
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: { sx: { ...paperSx, ...(sx as any) } },
        }}
        // 禁止浏览器默认右键菜单在此菜单内触发
        onContextMenu={(e) => e.preventDefault()}
      >
        {visibleItems.map((item, idx) => {
          const hasChildren = !!(item.children && item.children.length > 0);
          const isSubOpen = openSub?.index === idx;
          return (
            <React.Fragment key={`${item.label}-${idx}`}>
              {item.divider && <Divider sx={{ my: 0.15, borderColor: 'divider' }} />}
              <MenuItem
                onClick={() => handleItemClick(item)}
                onMouseEnter={(e) => handleItemMouseEnter(e, idx, item)}
                disabled={item.disabled}
                dense
                sx={{
                  ...itemSx(item.danger),
                  ...(isSubOpen && { bgcolor: 'action.selected' }),
                }}
              >
                {item.icon && (
                  <ListItemIcon>{item.icon}</ListItemIcon>
                )}
                <ListItemText
                  primary={item.label}
                  sx={{
                    m: 0,
                    flex: 1,
                    '& .MuiListItemText-primary': {
                      fontSize: '0.68rem',
                      lineHeight: 1.25,
                      color: item.danger ? '#f87171' : 'text.primary',
                      textAlign: 'left',
                    },
                  }}
                />
                {hasChildren && (
                  <Box sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                    <ChevronRightIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  </Box>
                )}
              </MenuItem>
            </React.Fragment>
          );
        })}
      </Menu>

      {/* 子菜单 (一级) */}
      <Menu
        open={!!openSub}
        onClose={() => setOpenSub(null)}
        anchorEl={openSub?.anchorEl ?? null}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        // 关键：不让子菜单抢占主菜单的焦点管理，主菜单保留 backdrop
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        // 允许鼠标穿越父项进入子菜单
        slotProps={{
          paper: {
            onMouseEnter: () => clearCloseTimer(),
            onMouseLeave: () => setOpenSub(null),
            sx: subPaperSx,
          },
          root: { sx: { pointerEvents: 'none' } },
        }}
        MenuListProps={{ sx: { pointerEvents: 'auto' } }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {(openSub && visibleItems[openSub.index]?.children
          ? (visibleItems[openSub.index].children as ContextMenuItemDef[])
          : []
        ).map((sub, sidx) => (
          <React.Fragment key={`sub-${sub.label}-${sidx}`}>
            {sub.divider && <Divider sx={{ my: 0.15, borderColor: 'divider' }} />}
            <MenuItem
              onClick={() => handleSubItemClick(sub)}
              disabled={sub.disabled}
              dense
              sx={itemSx(sub.danger)}
            >
              {sub.icon && <ListItemIcon>{sub.icon}</ListItemIcon>}
              <ListItemText
                primary={sub.label}
                sx={{
                  m: 0,
                  flex: 1,
                  '& .MuiListItemText-primary': {
                    fontSize: '0.68rem',
                    lineHeight: 1.25,
                    color: sub.danger ? '#f87171' : 'text.primary',
                    textAlign: 'left',
                  },
                }}
              />
            </MenuItem>
          </React.Fragment>
        ))}
      </Menu>
    </>
  );
};

export default ContextMenu;
