/**
 * 角色管理器组件
 * 左侧角色列表 + 右侧角色详情/权限管理
 * 参考 DBeaver 的权限管理 UI 布局
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
  List,
  ListItemButton,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Snackbar,
  Alert,
  CircularProgress,
  Divider,
  Collapse,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import SecurityIcon from '@mui/icons-material/Security';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { TableIcon, SchemaIcon, ViewIcon as TableViewIcon } from '../database-tree/DbIcons';
import { fetchRoles, fetchRoleGrants, createRole, updateRole, deleteRole, grantPrivilege, revokePrivilege, batchGrantPrivilege } from '../../services/tableMgmtService';
import type { RoleInfo, GrantInfo } from '../../services/tableMgmtService';
import { fetchConnectionSchemas, fetchMetadata } from '../../services/metadataService';
import Checkbox from '@mui/material/Checkbox';

interface RoleManagerProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
  schemaName?: string;
}

const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'DROP', 'ALL'];

const RoleManager: React.FC<RoleManagerProps> = ({ open, connectionId, onClose, schemaName }) => {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedRole, setSelectedRole] = useState<RoleInfo | null>(null);
  const [grants, setGrants] = useState<GrantInfo[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState('');

  // Create/Edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formRoleName, setFormRoleName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formCanLogin, setFormCanLogin] = useState(true);
  const [formSuperUser, setFormSuperUser] = useState(false);

  // Grant dialog
  const [grantOpen, setGrantOpen] = useState(false);
  const [selectedPrivs, setSelectedPrivs] = useState<Set<string>>(new Set(['SELECT']));
  // Tree selection state
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, string[]>>({});
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleInfo | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  // Load roles
  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchRoles(connectionId);
      setRoles(data);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (open) {
      loadRoles();
    }
  }, [open, loadRoles]);

  // Load grants for selected role
  const loadGrants = useCallback(async (role: RoleInfo) => {
    setGrantsLoading(true);
    setGrantsError('');
    try {
      const data = await fetchRoleGrants(connectionId, role.role_name);
      setGrants(data);
    } catch (err: any) {
      setGrantsError(err.message || '加载权限失败');
      setGrants([]);
    } finally {
      setGrantsLoading(false);
    }
  }, [connectionId]);

  const loadSchemas = useCallback(async () => {
    setSchemasLoading(true);
    try {
      const schemaList = await fetchConnectionSchemas(connectionId);
      setSchemas(schemaList);
      // Load tables for each schema
      const tables: Record<string, string[]> = {};
      for (const s of schemaList) {
        try {
          const meta = await fetchMetadata(connectionId, s);
          tables[s] = meta.map(t => t.name);
        } catch {
          tables[s] = [];
        }
      }
      setTablesBySchema(tables);
    } catch (err: any) {
      setSnackbar({ msg: '加载 Schema 列表失败: ' + err.message, severity: 'error' });
    } finally {
      setSchemasLoading(false);
    }
  }, [connectionId]);

  const handleSelectRole = (role: RoleInfo) => {
    setSelectedRole(role);
    loadGrants(role);
  };

  // Aggregate grants by schema -> table -> privileges (tree structure)
  const aggregatedGrants = useMemo(() => {
    const schemaTree = new Map<string, Map<string, Set<string>>>();

    for (const grant of grants) {
      let schema = grant.table_schema || '';
      let table = grant.table_name || '';

      if (table && schema) {
        // already have both
      } else if (table) {
        schema = '';
      } else if (grant.grantStatement) {
        // Parse MySQL GRANT statement: GRANT SELECT ON `db`.`table` TO 'user'@'%'
        const privMatch = grant.grantStatement.match(/GRANT\s+\w+\s+ON\s+`?(\w+)`?\.`?(\w+)`?/i);
        if (privMatch) {
          schema = privMatch[1];
          table = privMatch[2];
        } else {
          // Fallback: use the whole object part
          const obj = extractObject(grant.grantStatement);
          table = obj.replace(/`/g, '');
          schema = '';
        }
      } else {
        continue;
      }

      const schemaKey = schema || '(无 Schema)';

      if (!schemaTree.has(schemaKey)) {
        schemaTree.set(schemaKey, new Map());
      }

      const tables = schemaTree.get(schemaKey)!;
      if (!tables.has(table)) {
        tables.set(table, new Set());
      }

      const priv = grant.privilege_type || (grant.grantStatement ? extractPrivilege(grant.grantStatement) : '');
      if (priv) {
        tables.get(table)!.add(priv);
      }
    }

    return schemaTree;
  }, [grants]);

  // Create role
  const handleCreate = () => {
    setFormMode('create');
    setFormRoleName('');
    setFormPassword('');
    setFormCanLogin(true);
    setFormSuperUser(false);
    setFormOpen(true);
  };

  // Edit role
  const handleEdit = () => {
    if (!selectedRole) return;
    setFormMode('edit');
    setFormRoleName(selectedRole.role_name);
    setFormPassword('');
    setFormCanLogin(selectedRole.can_login === true || selectedRole.can_login === 'Y');
    setFormSuperUser(selectedRole.super_user === true || selectedRole.super_user === 'Y');
    setFormOpen(true);
  };

  // Save role
  const handleSaveRole = async () => {
    try {
      if (formMode === 'create') {
        await createRole(connectionId, {
          roleName: formRoleName,
          password: formPassword || undefined,
          canLogin: formCanLogin,
          superUser: formSuperUser,
        });
        setSnackbar({ msg: `角色 ${formRoleName} 创建成功`, severity: 'success' });
      } else {
        await updateRole(connectionId, formRoleName, {
          newPassword: formPassword || undefined,
          canLogin: formCanLogin,
          superUser: formSuperUser,
        });
        setSnackbar({ msg: `角色 ${formRoleName} 修改成功`, severity: 'success' });
      }
      setFormOpen(false);
      loadRoles();
    } catch (err: any) {
      setSnackbar({ msg: err.message || '操作失败', severity: 'error' });
    }
  };

  // Delete role
  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    setDeleteOpen(true);
  };

  const handleDeleteExecute = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRole(connectionId, deleteTarget.role_name);
      setSnackbar({ msg: `角色 ${deleteTarget.role_name} 已删除`, severity: 'success' });
      setDeleteOpen(false);
      setDeleteTarget(null);
      if (selectedRole?.role_name === deleteTarget.role_name) {
        setSelectedRole(null);
        setGrants([]);
      }
      loadRoles();
    } catch (err: any) {
      setSnackbar({ msg: err.message || '删除失败', severity: 'error' });
    }
  };

  // Grant privilege with tree-selected tables
  const handleGrant = async () => {
    if (!selectedRole || selectedPrivs.size === 0 || selectedTables.size === 0) return;
    try {
      // Group selected tables by schema for batch calls
      const bySchema = new Map<string, string[]>();
      for (const key of selectedTables) {
        const dotIdx = key.indexOf('.');
        const schema = key.substring(0, dotIdx);
        const table = key.substring(dotIdx + 1);
        if (!bySchema.has(schema)) bySchema.set(schema, []);
        bySchema.get(schema)!.push(table);
      }
      for (const priv of selectedPrivs) {
        for (const [schema, tables] of bySchema.entries()) {
          await batchGrantPrivilege(connectionId, selectedRole.role_name, {
            privilege: priv,
            tables,
            schema,
          });
        }
      }
      setSnackbar({ msg: `已向 ${selectedTables.size} 个表授予 ${selectedPrivs.size} 项权限`, severity: 'success' });
      setGrantOpen(false);
      loadGrants(selectedRole);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '授予失败', severity: 'error' });
    }
  };

  // Toggle privilege (grant if not present, revoke if present)
  const handlePrivilegeToggle = async (
    schema: string,
    table: string,
    priv: string
  ) => {
    if (!selectedRole) return;
    const schemaTree = aggregatedGrants;
    const tables = schemaTree.get(schema);
    const privs = tables?.get(table);
    const hasPriv = privs?.has(priv) ?? false;
    try {
      if (hasPriv) {
        await revokePrivilege(connectionId, selectedRole.role_name, {
          privilege: priv,
          table: table || undefined,
          schema: schema === '(无 Schema)' ? schemaName : schema || schemaName,
        });
        setSnackbar({ msg: `权限 ${priv} 已撤销`, severity: 'success' });
      } else {
        await grantPrivilege(connectionId, selectedRole.role_name, {
          privilege: priv,
          table: table || undefined,
          schema: schema === '(无 Schema)' ? schemaName : schema || schemaName,
        });
        setSnackbar({ msg: `权限 ${priv} 已授予`, severity: 'success' });
      }
      loadGrants(selectedRole);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '操作失败', severity: 'error' });
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid', borderColor: 'divider',
            borderRadius: 1,
            height: '70vh',
          },
        }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon sx={{ fontSize: 18 }} />
          角色管理
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', gap: 2, overflow: 'hidden' }}>
          {/* Left panel: role list */}
          <Box sx={{ width: 240, minWidth: 240, borderRight: '1px solid', borderRightColor: 'divider', pr: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
                角色列表
              </Typography>
              <Box>
                <Tooltip title="刷新">
                  <IconButton size="small" onClick={loadRoles} sx={{ p: 0.25 }}>
                    <RefreshIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="新建角色">
                  <IconButton size="small" onClick={handleCreate} sx={{ p: 0.25 }}>
                    <AddIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={14} />
              </Box>
            )}
            {error && (
              <Typography variant="caption" color="error" sx={{ fontSize: '0.65rem', px: 0.5 }}>{error}</Typography>
            )}

            <List dense disablePadding sx={{ flex: 1, overflow: 'auto' }}>
              {roles.map((role) => (
                <ListItemButton
                  key={role.role_name}
                  selected={selectedRole?.role_name === role.role_name}
                  onClick={() => handleSelectRole(role)}
                  sx={{
                    py: 0.25,
                    px: 0.5,
                    borderRadius: 0.5,
                    mb: 0.25,
                    '&.Mui-selected': { bgcolor: 'action.selected' },
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <PersonIcon sx={{ fontSize: 13, color: 'text.secondary', mr: 0.75 }} />
                  <ListItemText
                    primary={
                      <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.primary' }}>
                        {role.role_name}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
              {!loading && roles.length === 0 && (
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem', px: 0.5, py: 1 }}>
                  暂无角色
                </Typography>
              )}
            </List>
          </Box>

          {/* Right panel: role details + grants */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selectedRole ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                  请选择左侧角色查看详情
                </Typography>
              </Box>
            ) : (
              <>
                {/* Role info */}
                <Box sx={{ mb: 1, p: 1, bgcolor: 'action.selected', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.72rem' }}>
                      {selectedRole.role_name}
                    </Typography>
                    <Box>
                      <Tooltip title="编辑角色">
                        <IconButton size="small" onClick={handleEdit} sx={{ p: 0.25, mr: 0.5 }}>
                          <EditIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除角色">
                        <IconButton size="small" onClick={() => { setDeleteTarget(selectedRole); setDeleteOpen(true); }} sx={{ p: 0.25 }}>
                          <DeleteIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {selectedRole.can_login !== undefined && (
                      <Chip
                        label={selectedRole.can_login === true || selectedRole.can_login === 'Y' ? '可登录' : '不可登录'}
                        size="small"
                        color={selectedRole.can_login === true || selectedRole.can_login === 'Y' ? 'success' : 'default'}
                        variant="outlined"
                        sx={{ fontSize: '0.55rem', height: 16 }}
                      />
                    )}
                    {selectedRole.super_user !== undefined && (
                      <Chip
                        label={selectedRole.super_user === true || selectedRole.super_user === 'Y' ? '超级用户' : '普通用户'}
                        size="small"
                        color={selectedRole.super_user === true || selectedRole.super_user === 'Y' ? 'warning' : 'default'}
                        variant="outlined"
                        sx={{ fontSize: '0.55rem', height: 16 }}
                      />
                    )}
                    {selectedRole.can_create_db !== undefined && (
                      <Chip
                        label={selectedRole.can_create_db === true || selectedRole.can_create_db === 'Y' ? '可建库' : '不可建库'}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.55rem', height: 16 }}
                      />
                    )}
                  </Box>
                </Box>

                {/* Grants table */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.68rem' }}>
                      权限列表
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddIcon sx={{ fontSize: 12 }} />}
                      onClick={() => {
                        setSelectedPrivs(new Set(['SELECT']));
                        setSelectedTables(new Set());
                        setExpandedSchemas(new Set());
                        loadSchemas();
                        setGrantOpen(true);
                      }}
                      sx={{ fontSize: '0.62rem', py: 0, minHeight: 20, textTransform: 'none' }}
                    >
                      + 批量授权
                    </Button>
                  </Box>

                  {grantsLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                      <CircularProgress size={14} />
                    </Box>
                  )}
                  {grantsError && (
                    <Typography variant="caption" color="error" sx={{ fontSize: '0.65rem' }}>{grantsError}</Typography>
                  )}

                  <TableContainer
                    component={Paper}
                    sx={{
                      flex: 1,
                      overflow: 'auto',
                      bgcolor: 'transparent',
                      border: '1px solid', borderColor: 'divider',
                      borderRadius: 0.5,
                    }}
                  >
                    <Table size="small" sx={{ minWidth: 400 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ color: 'text.secondary', fontSize: '0.62rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>
                            对象
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: '0.62rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>
                            权限（点击切换）
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {aggregatedGrants.size === 0 && (
                          <TableRow>
                            <TableCell colSpan={2} sx={{ borderBottom: 'none', py: 2 }}>
                              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem', display: 'block', textAlign: 'center' }}>
                                暂无权限
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                        {Array.from(aggregatedGrants.entries()).map(([schema, tables]) => (
                          <React.Fragment key={schema}>
                            {/* Schema 行 */}
                            <TableRow>
                              <TableCell colSpan={2} sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, bgcolor: 'action.hover' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <SchemaIcon size={11} />
                                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.6rem', color: 'text.primary' }}>{schema}</Typography>
                                </Box>
                              </TableCell>
                            </TableRow>
                            {/* 该 Schema 下的表 */}
                            {Array.from(tables.entries()).map(([table, privs]) => (
                              <TableRow key={table}>
                                <TableCell sx={{ pl: 4, color: 'text.primary', fontSize: '0.6rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>
                                  {table}
                                </TableCell>
                                <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>
                                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {PRIVILEGES.map(priv => {
                                      const hasPriv = privs.has(priv);
                                      return (
                                        <Chip
                                          key={priv}
                                          label={priv}
                                          size="small"
                                          color={hasPriv ? 'primary' : 'default'}
                                          variant={hasPriv ? 'filled' : 'outlined'}
                                          onClick={() => handlePrivilegeToggle(schema, table, priv)}
                                          sx={{
                                            fontSize: '0.55rem',
                                            height: 18,
                                            cursor: 'pointer',
                                            ...(hasPriv ? {} : { opacity: 0.35 }),
                                          }}
                                        />
                                      );
                                    })}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </React.Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={onClose}
            size="small"
            sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}
          >
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create/Edit Role Dialog */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 } }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1 }}>
          {formMode === 'create' ? '新建角色' : '编辑角色'}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            autoFocus
            size="small"
            margin="dense"
            label="角色名称"
            value={formRoleName}
            onChange={(e) => setFormRoleName(e.target.value)}
            fullWidth
            disabled={formMode === 'edit'}
            sx={{ mb: 1.5, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
          />
          <TextField
            size="small"
            margin="dense"
            label="密码（可选）"
            type="password"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            fullWidth
            sx={{ mb: 1.5, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={formCanLogin} onChange={(e) => setFormCanLogin(e.target.checked)} />}
            label={<Typography variant="caption" sx={{ fontSize: '0.68rem' }}>允许登录</Typography>}
            sx={{ mb: 0.5, display: 'flex' }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={formSuperUser} onChange={(e) => setFormSuperUser(e.target.checked)} />}
            label={<Typography variant="caption" sx={{ fontSize: '0.68rem' }}>超级用户</Typography>}
            sx={{ display: 'flex' }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFormOpen(false)} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleSaveRole}
            variant="contained"
            size="small"
            disabled={!formRoleName.trim()}
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            {formMode === 'create' ? '创建' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Grant Privilege Dialog */}
      <Dialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 } }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1 }}>
          批量授权
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {/* Privilege multi-select chips */}
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', mb: 0.5, display: 'block' }}>
            权限类型（点击多选）
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
            {PRIVILEGES.map(p => {
              const selected = selectedPrivs.has(p);
              return (
                <Chip
                  key={p}
                  label={p}
                  size="small"
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={() => {
                    const next = new Set(selectedPrivs);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    setSelectedPrivs(next);
                  }}
                  sx={{ fontSize: '0.6rem', cursor: 'pointer', ...(selected ? {} : { opacity: 0.5 }) }}
                />
              );
            })}
          </Box>

          {/* Grant scope - tree selection */}
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', mb: 0.5, display: 'block' }}>
            选择要授权的对象
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0.5, overflow: 'auto', maxHeight: 300 }}>
            {schemasLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={14} />
              </Box>
            ) : schemas.length === 0 ? (
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem', p: 1, display: 'block', textAlign: 'center' }}>
                无可用 Schema
              </Typography>
            ) : (
              schemas.map(schema => {
                const schemaTables = tablesBySchema[schema] || [];
                const allSelected = schemaTables.length > 0 && schemaTables.every(t => selectedTables.has(`${schema}.${t}`));
                const someSelected = schemaTables.some(t => selectedTables.has(`${schema}.${t}`));
                return (
                  <Box key={schema}>
                    {/* Schema row */}
                    <ListItemButton
                      onClick={() => {
                        const next = new Set(expandedSchemas);
                        if (next.has(schema)) next.delete(schema); else next.add(schema);
                        setExpandedSchemas(next);
                      }}
                      sx={{ py: 0.25, minHeight: 28, px: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      {expandedSchemas.has(schema)
                        ? <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.secondary', mr: 0.5 }} />
                        : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.secondary', mr: 0.5 }} />}
                      <Checkbox
                        size="small"
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          const checked = e.target.checked;
                          const next = new Set(selectedTables);
                          for (const table of schemaTables) {
                            if (checked) next.add(`${schema}.${table}`);
                            else next.delete(`${schema}.${table}`);
                          }
                          setSelectedTables(next);
                        }}
                        sx={{ p: 0, mr: 0.5 }}
                      />
                      <SchemaIcon size={13} style={{ marginRight: 4 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.primary' }}>{schema}</Typography>
                    </ListItemButton>
                    <Collapse in={expandedSchemas.has(schema)} timeout="auto">
                      {schemaTables.map(table => (
                        <ListItemButton
                          key={table}
                          onClick={() => {
                            const key = `${schema}.${table}`;
                            const next = new Set(selectedTables);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            setSelectedTables(next);
                          }}
                          sx={{ py: 0.25, minHeight: 28, pl: 5, pr: 1, '&:hover': { bgcolor: 'action.hover' } }}
                        >
                          <Checkbox
                            size="small"
                            checked={selectedTables.has(`${schema}.${table}`)}
                            sx={{ p: 0, mr: 0.5 }}
                          />
                          <TableIcon size={11} style={{ marginRight: 4 }} />
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>{table}</Typography>
                        </ListItemButton>
                      ))}
                    </Collapse>
                  </Box>
                );
              })
            )}
          </Box>
          {selectedTables.size > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', mt: 1, display: 'block' }}>
              已选择 {selectedTables.size} 个对象
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setGrantOpen(false)} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleGrant}
            variant="contained"
            size="small"
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            授予
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 } }}
      >
        <DialogTitle sx={{ color: '#f87171', fontSize: '0.85rem', fontWeight: 600, pb: 1 }}>
          确认删除
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2" sx={{ color: '#cbd5e1', fontSize: '0.75rem' }}>
            确定要删除角色 <strong>{deleteTarget?.role_name}</strong> 吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleDeleteExecute}
            variant="contained"
            size="small"
            color="error"
            sx={{ fontSize: '0.7rem', textTransform: 'none' }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar ? (
          <Alert severity={snackbar.severity} sx={{ width: '100%', fontSize: '0.75rem' }}>
            {snackbar.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
};

/** 从 GRANT statement 中提取权限类型 */
function extractPrivilege(statement: string): string {
  const match = statement.match(/GRANT\s+(\w+)\s+ON/i);
  return match ? match[1] : '';
}

/** 从 GRANT statement 中提取对象 */
function extractObject(statement: string): string {
  const match = statement.match(/ON\s+([^\s]+)\s+TO/i);
  return match ? match[1] : '';
}

export default RoleManager;
