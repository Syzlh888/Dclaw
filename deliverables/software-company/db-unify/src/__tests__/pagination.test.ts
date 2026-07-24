/**
 * 分页/无限滚动功能测试
 * 覆盖：hasSqlLimit、canAppendLimit、pageSize 状态范围、hasMore 判断
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { hasSqlLimit, canAppendLimit } from '../utils/sqlUtils';
import { useEditorStore } from '../stores/editorStore';

/**
 * 重置 editorStore 到初始状态
 */
function resetEditorStore() {
  // 直接操作 zustand store 的初始状态
  useEditorStore.setState({
    pageSize: 100,
    loadingMore: false,
    resultMeta: {},
    loadMoreFn: null,
  });
}

// ============================
// hasSqlLimit 单元测试
// ============================
describe('hasSqlLimit — SQL LIMIT 检测', () => {
  it('检测到 LIMIT 子句', () => {
    expect(hasSqlLimit('SELECT * FROM users LIMIT 10')).toBe(true);
    expect(hasSqlLimit('SELECT * FROM users limit 100')).toBe(true);
    expect(hasSqlLimit('SELECT * FROM users\nLIMIT 50')).toBe(true);
  });

  it('检测到 SELECT TOP', () => {
    expect(hasSqlLimit('SELECT TOP 10 * FROM users')).toBe(true);
  });

  it('检测到 FETCH NEXT', () => {
    expect(hasSqlLimit('SELECT * FROM users OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY')).toBe(true);
  });

  it('检测到 FETCH FIRST', () => {
    expect(hasSqlLimit('SELECT * FROM users OFFSET 0 ROWS FETCH FIRST 10 ROWS ONLY')).toBe(true);
  });

  it('检测到 ROWNUM', () => {
    expect(hasSqlLimit('SELECT * FROM (SELECT a.*, ROWNUM rnum FROM users a WHERE ROWNUM <= 50) WHERE rnum > 0')).toBe(true);
  });

  it('无 LIMIT 的普通 SELECT 返回 false', () => {
    expect(hasSqlLimit('SELECT * FROM users')).toBe(false);
    expect(hasSqlLimit('SELECT id, name FROM orders WHERE status = 1')).toBe(false);
  });

  it('WITH 子句不带 LIMIT', () => {
    expect(hasSqlLimit('WITH cte AS (SELECT * FROM users) SELECT * FROM cte')).toBe(false);
  });

  it('WITH 子句带 LIMIT', () => {
    expect(hasSqlLimit('WITH cte AS (SELECT * FROM users LIMIT 5) SELECT * FROM cte')).toBe(true);
  });

  it('空字符串返回 false', () => {
    expect(hasSqlLimit('')).toBe(false);
  });

  it('INSERT/UPDATE/DELETE 不匹配 LIMIT pattern（即使含 limit 字）', () => {
    // INSERT 中的 limit 不会写成 LIMIT [数字] 形式
    expect(hasSqlLimit('INSERT INTO users (name) VALUES ("limit_user")')).toBe(false);
    // DELETE 可能带 LIMIT
    expect(hasSqlLimit('DELETE FROM users LIMIT 1')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(hasSqlLimit('select * from users limit 42')).toBe(true);
    expect(hasSqlLimit('SELECT * FROM users Limit 100')).toBe(true);
  });
});

// ============================
// canAppendLimit 单元测试
// ============================
describe('canAppendLimit — 判断可否追加 LIMIT', () => {
  it('SELECT 不带 LIMIT → true', () => {
    expect(canAppendLimit('SELECT * FROM users')).toBe(true);
  });

  it('SELECT 带 LIMIT → false', () => {
    expect(canAppendLimit('SELECT * FROM users LIMIT 100')).toBe(false);
  });

  it('WITH 不带 LIMIT → true', () => {
    expect(canAppendLimit('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(true);
  });

  it('INSERT → false', () => {
    expect(canAppendLimit('INSERT INTO users VALUES (1)')).toBe(false);
  });

  it('DELETE → false（虽含 LIMIT pattern，但不是 SELECT/WITH 开头）', () => {
    expect(canAppendLimit('DELETE FROM users WHERE id = 1')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(canAppendLimit('')).toBe(false);
  });

  it('分号结尾的 SELECT → true', () => {
    expect(canAppendLimit('SELECT 1;')).toBe(true);
  });
});

// ============================
// editorStore pageSize 状态测试
// ============================
describe('editorStore — 分页状态管理', () => {
  beforeEach(() => {
    resetEditorStore();
  });

  it('默认 pageSize = 100', () => {
    expect(useEditorStore.getState().pageSize).toBe(100);
  });

  it('默认 loadingMore = false', () => {
    expect(useEditorStore.getState().loadingMore).toBe(false);
  });

  it('默认 resultMeta = {}', () => {
    expect(useEditorStore.getState().resultMeta).toEqual({});
  });

  it('setPageSize 范围限制：最小值 10', () => {
    useEditorStore.getState().setPageSize(5);
    expect(useEditorStore.getState().pageSize).toBe(10);
  });

  it('setPageSize 范围限制：最大值 10000', () => {
    useEditorStore.getState().setPageSize(99999);
    expect(useEditorStore.getState().pageSize).toBe(10000);
  });

  it('setPageSize 正常值', () => {
    useEditorStore.getState().setPageSize(500);
    expect(useEditorStore.getState().pageSize).toBe(500);
  });

  it('setPageSize 小数会被取整', () => {
    useEditorStore.getState().setPageSize(50.7);
    expect(useEditorStore.getState().pageSize).toBe(51);
  });

  it('setLoadingMore 切换状态', () => {
    useEditorStore.getState().setLoadingMore(true);
    expect(useEditorStore.getState().loadingMore).toBe(true);
    useEditorStore.getState().setLoadingMore(false);
    expect(useEditorStore.getState().loadingMore).toBe(false);
  });

  it('updateResultMeta 正确存储', () => {
    useEditorStore.getState().updateResultMeta('conn-1', { hasMore: true, totalLoaded: 100 });
    expect(useEditorStore.getState().resultMeta['conn-1']).toEqual({ hasMore: true, totalLoaded: 100 });
  });

  it('resultMeta 多个连接互不干扰', () => {
    useEditorStore.getState().updateResultMeta('conn-1', { hasMore: true, totalLoaded: 100 });
    useEditorStore.getState().updateResultMeta('conn-2', { hasMore: false, totalLoaded: 50 });
    expect(useEditorStore.getState().resultMeta['conn-1']).toEqual({ hasMore: true, totalLoaded: 100 });
    expect(useEditorStore.getState().resultMeta['conn-2']).toEqual({ hasMore: false, totalLoaded: 50 });
  });

  it('resetPagination 清空 resultMeta 和 loadingMore', () => {
    useEditorStore.getState().setLoadingMore(true);
    useEditorStore.getState().updateResultMeta('conn-1', { hasMore: true, totalLoaded: 100 });
    useEditorStore.getState().resetPagination();
    expect(useEditorStore.getState().resultMeta).toEqual({});
    expect(useEditorStore.getState().loadingMore).toBe(false);
  });

  it('setLoadMoreFn 设置函数引用', () => {
    const fn = (id: string) => { /* noop */ };
    useEditorStore.getState().setLoadMoreFn(fn);
    expect(useEditorStore.getState().loadMoreFn).toBe(fn);
    useEditorStore.getState().setLoadMoreFn(null);
    expect(useEditorStore.getState().loadMoreFn).toBeNull();
  });
});

// ============================
// hasMore 判断逻辑测试（独立于后端）
// ============================
describe('hasMore 判断逻辑', () => {
  it('返回行数等于 pageSize → hasMore=true', () => {
    const returnedRows = 100;
    const pageSize = 100;
    const hasMore = returnedRows >= pageSize;
    expect(hasMore).toBe(true);
  });

  it('返回行数小于 pageSize → hasMore=false', () => {
    const returnedRows = 42;
    const pageSize = 100;
    const hasMore = returnedRows >= pageSize;
    expect(hasMore).toBe(false);
  });

  it('返回行数大于 pageSize（不太可能，但防御性处理）→ hasMore=true', () => {
    const returnedRows = 150;
    const pageSize = 100;
    const hasMore = returnedRows >= pageSize;
    expect(hasMore).toBe(true);
  });

  it('非分页模式（pageSize=0）始终 hasMore=false', () => {
    const effectivePageSize = 0;
    const needsPagination = effectivePageSize > 0 && canAppendLimit('SELECT 1');
    expect(needsPagination).toBe(false);
  });

  it('用户 SQL 已含 LIMIT 时，即使 pageSize>0 也不分页', () => {
    // 后端逻辑：needsPagination = pageSize>0 && canAppendLimit(sql)
    // canAppendLimit 检测到 LIMIT 返回 false
    expect(canAppendLimit('SELECT * FROM t LIMIT 100')).toBe(false);
  });
});
