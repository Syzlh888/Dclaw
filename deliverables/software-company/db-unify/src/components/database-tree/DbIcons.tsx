/**
 * DBeaver 风格的数据库树节点 SVG 图标
 * 4 种类型：Connection（连接）/ Schema / Table（表）/ View（视图）
 *
 * 特点：
 *   - 纯 SVG（矢量清晰无锯齿），支持 currentColor 或指定 color
 *   - 尺寸可通过 size prop 控制（默认 14px）
 *   - 配色沿用 DBeaver：数据蓝 / 青色 / 白（浅灰）/ 金橙
 */

import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

/** 连接（Hospital）：三层堆叠数据库柱体 —— 蓝色 #4DB8E6 */
export const ConnectionIcon: React.FC<IconProps> = ({ size = 14, color = '#4DB8E6', style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style} xmlns="http://www.w3.org/2000/svg">
    {/* 顶部椭圆（面） */}
    <ellipse cx="8" cy="3" rx="5.5" ry="1.8" fill={color} />
    {/* 中间柱体侧面 */}
    <path
      d="M2.5 3 L2.5 8 C2.5 9 5 9.8 8 9.8 C11 9.8 13.5 9 13.5 8 L13.5 3"
      fill={color}
      opacity="0.85"
    />
    {/* 中间横向分层线 */}
    <path
      d="M2.5 5.5 C2.5 6.5 5 7.3 8 7.3 C11 7.3 13.5 6.5 13.5 5.5"
      stroke="#2B2B2B"
      strokeWidth="0.6"
      fill="none"
    />
    {/* 底部柱体侧面 */}
    <path
      d="M2.5 8 L2.5 13 C2.5 14 5 14.8 8 14.8 C11 14.8 13.5 14 13.5 13 L13.5 8"
      fill={color}
      opacity="0.75"
    />
    <path
      d="M2.5 10.5 C2.5 11.5 5 12.3 8 12.3 C11 12.3 13.5 11.5 13.5 10.5"
      stroke="#2B2B2B"
      strokeWidth="0.6"
      fill="none"
    />
  </svg>
);

/** Schema：文档 + 3 行方形列表项 —— 青色 #4EC9B0 */
export const SchemaIcon: React.FC<IconProps> = ({ size = 14, color = '#4EC9B0', style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style} xmlns="http://www.w3.org/2000/svg">
    {/* 文档轮廓（带右上折角） */}
    <path
      d="M3 1.5 L10.5 1.5 L13 4 L13 14 L3 14 Z"
      stroke={color}
      strokeWidth="1"
      fill="none"
      strokeLinejoin="round"
    />
    {/* 折角三角形 */}
    <path
      d="M10.5 1.5 L10.5 4 L13 4"
      stroke={color}
      strokeWidth="1"
      fill="none"
      strokeLinejoin="round"
    />
    {/* 3 行列表项 */}
    <rect x="4.5" y="6" width="1.5" height="1.5" fill={color} />
    <line x1="6.8" y1="6.75" x2="11.5" y2="6.75" stroke={color} strokeWidth="0.9" strokeLinecap="round" />

    <rect x="4.5" y="8.75" width="1.5" height="1.5" fill={color} />
    <line x1="6.8" y1="9.5" x2="11.5" y2="9.5" stroke={color} strokeWidth="0.9" strokeLinecap="round" />

    <rect x="4.5" y="11.5" width="1.5" height="1.5" fill={color} />
    <line x1="6.8" y1="12.25" x2="11.5" y2="12.25" stroke={color} strokeWidth="0.9" strokeLinecap="round" />
  </svg>
);

/** 表（Table）：网格表格 2×3（顶部有表头行）—— 白/浅灰 #E0E0E0 */
export const TableIcon: React.FC<IconProps> = ({ size = 14, color = '#E0E0E0', style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style} xmlns="http://www.w3.org/2000/svg">
    {/* 外框 */}
    <rect x="1.5" y="2.5" width="13" height="11" stroke={color} strokeWidth="1" fill="none" rx="0.5" />
    {/* 表头背景填充 */}
    <rect x="2" y="3" width="12" height="2.2" fill={color} opacity="0.6" />
    {/* 表头下分隔线（加粗） */}
    <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" stroke={color} strokeWidth="1" />
    {/* 数据行分隔线 */}
    <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" stroke={color} strokeWidth="0.7" />
    {/* 列分隔线（2 条，形成 3 列） */}
    <line x1="6" y1="5.5" x2="6" y2="13.5" stroke={color} strokeWidth="0.7" />
    <line x1="10.5" y1="5.5" x2="10.5" y2="13.5" stroke={color} strokeWidth="0.7" />
  </svg>
);

/** 视图（View）：眼睛 —— 金橙 #DAAA4E */
export const ViewIcon: React.FC<IconProps> = ({ size = 14, color = '#DAAA4E', style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style} xmlns="http://www.w3.org/2000/svg">
    {/* 眼睛外轮廓（上下两条弧线组成杏仁形） */}
    <path
      d="M1.5 8 C3.5 4.5 5.5 3 8 3 C10.5 3 12.5 4.5 14.5 8 C12.5 11.5 10.5 13 8 13 C5.5 13 3.5 11.5 1.5 8 Z"
      stroke={color}
      strokeWidth="1.1"
      fill="none"
      strokeLinejoin="round"
    />
    {/* 瞳孔（实心圆） */}
    <circle cx="8" cy="8" r="2.2" fill={color} />
    {/* 高光小点 */}
    <circle cx="8.8" cy="7.2" r="0.5" fill="#2B2B2B" />
  </svg>
);
