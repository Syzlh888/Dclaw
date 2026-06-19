import React, { useCallback, useRef } from 'react';
import { Box } from '@mui/material';

interface ResizableHandleProps {
  direction: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
  style?: React.CSSProperties;
}

/**
 * 可拖拽调整大小的分割条组件
 * - vertical: 垂直分割条（调整宽度），放在两个面板之间，鼠标左右拖拽
 * - horizontal: 水平分割条（调整高度），放在上下两个面板之间，鼠标上下拖拽
 */
const ResizableHandle: React.FC<ResizableHandleProps> = ({ direction, onResize, style }) => {
  const dragging = useRef(false);
  const startPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = direction === 'vertical' ? e.clientX : e.clientY;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const currentPos = direction === 'vertical' ? ev.clientX : ev.clientY;
        const delta = currentPos - startPos.current;
        startPos.current = currentPos;
        onResize(delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, onResize]
  );

  const isVertical = direction === 'vertical';

  return (
    <Box
      onMouseDown={handleMouseDown}
      sx={{
        flexShrink: 0,
        ...(isVertical
          ? {
              width: 4,
              cursor: 'col-resize',
              '&:hover': { bgcolor: 'primary.main', opacity: 0.5 },
            }
          : {
              height: 4,
              cursor: 'row-resize',
              '&:hover': { bgcolor: 'primary.main', opacity: 0.5 },
            }),
        bgcolor: 'transparent',
        transition: 'background-color 0.2s',
        zIndex: 10,
        ...style,
      }}
    />
  );
};

export default ResizableHandle;
