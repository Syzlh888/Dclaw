import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  Alert,
  Stack,
  CircularProgress,
  Autocomplete,
  Divider,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import { DbDriver, ConnectionStatus } from '../../types/connection';
import type { DbConnection } from '../../types/connection';
import { useDriverStore } from '../../stores/driverStore';
import { fetchSchemas } from '../../services/connectionService';
import { fetchPlatforms, fetchPredbTypes, fetchDistricts, fetchHospitalByConnection } from '../../services/treeService';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DnsIcon from '@mui/icons-material/Dns';
import DriverUpload from '../driver/DriverUpload';
import { useServerStore } from '../../stores/serverStore';

/** 层级路径信息（项目→业务模块→区域节点→连接实例） */
export interface TreePathInfo {
  platformId: string;
  predbTypeId: string;
  districtId: string;
  hospitalName: string;
}

interface ConnectionFormProps {
  connection?: DbConnection;
  /** Pre-filled name when creating a new connection (e.g. from tree node name) */
  defaultName?: string;
  onSave: (data: Omit<DbConnection, 'id'>) => void;
  onCancel: () => void;
  /** 是否显示层级选择区域（仅在连接管理弹窗中使用） */
  showTreePath?: boolean;
  /** 层级选择是否锁定（DatabaseTree 场景中已确定层级，不可更改） */
  treePathLocked?: boolean;
  /** 当包含层级信息保存时回调（ConnectionDialog 使用） */
  onSaveWithTree?: (data: Omit<DbConnection, 'id'>, treePath: TreePathInfo) => void;
}

const ConnectionForm: React.FC<ConnectionFormProps> = ({
  connection,
  defaultName,
  onSave,
  onCancel,
  showTreePath = false,
  treePathLocked = false,
  onSaveWithTree,
}) => {
  const drivers = useDriverStore((s) => s.drivers);
  const servers = useServerStore(s => s.servers);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);

  const getDefaultPort = (drv: DbDriver, cid?: string): number => {
    switch (drv) {
      case DbDriver.MySQL: return 3306;
      case DbDriver.PostgreSQL: return 5432;
      case DbDriver.Oracle: return 1521;
      case DbDriver.SQLServer: return 1433;
      default: {
        if (cid && drivers[cid]) {
          const dt = drivers[cid].dbType.toLowerCase();
          if (dt === 'mysql') return 3306;
          if (dt === 'postgresql') return 5432;
          if (dt === 'oracle') return 1521;
          if (dt === 'sqlserver') return 1433;
        }
        return 3306;
      }
    }
  };

  const [name, setName] = useState(connection?.name ?? defaultName ?? '');
  const [driver, setDriver] = useState<DbDriver>(connection?.driver ?? DbDriver.MySQL);
  const [host, setHost] = useState(connection?.host ?? 'localhost');
  const [port, setPort] = useState(connection?.port ?? getDefaultPort(connection?.driver ?? DbDriver.MySQL, connection?.customDriverId));
  const [username, setUsername] = useState(connection?.username ?? '');
  const [password, setPassword] = useState(connection?.password ?? '');
  const [database, setDatabase] = useState(connection?.database ?? '');
  const [schema, setSchema] = useState(connection?.schema ?? '');
  const [customDriverId, setCustomDriverId] = useState<string>(connection?.customDriverId ?? '');
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
  const [testError, setTestError] = useState<string>('');
  const [testConnecting, setTestConnecting] = useState(false);

  const [schemaOptions, setSchemaOptions] = useState<string[]>([]);
  const [schemasFetched, setSchemasFetched] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  const [showDriverUpload, setShowDriverUpload] = useState(false);
  const [preUploadDriverIds, setPreUploadDriverIds] = useState<Set<string>>(new Set());

  // ---- 层级级联选择器状态 ----
  const [platforms, setPlatforms] = useState<Array<{ id: string; name: string }>>([]);
  const [predbTypes, setPredbTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [districts, setDistricts] = useState<Array<{ id: string; name: string }>>([]);

  const [selectedPlatformId, setSelectedPlatformId] = useState('');
  const [selectedPredbTypeId, setSelectedPredbTypeId] = useState('');
  const [selectedDistrictId, setSelectedDistrictId] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [treePathLoading, setTreePathLoading] = useState(false);

  // 加载项目列表
  useEffect(() => {
    if (!showTreePath) return;
    fetchPlatforms()
      .then(setPlatforms)
      .catch(() => setPlatforms([]));
  }, [showTreePath]);

  // 当选中项目变化时，加载对应的业务模块
  useEffect(() => {
    if (!showTreePath || !selectedPlatformId) {
      setPredbTypes([]);
      return;
    }
    fetchPredbTypes(selectedPlatformId)
      .then(setPredbTypes)
      .catch(() => setPredbTypes([]));
  }, [showTreePath, selectedPlatformId]);

  // 当选中业务模块变化时，加载对应的区域节点
  useEffect(() => {
    if (!showTreePath || !selectedPredbTypeId) {
      setDistricts([]);
      return;
    }
    fetchDistricts(selectedPredbTypeId)
      .then(setDistricts)
      .catch(() => setDistricts([]));
  }, [showTreePath, selectedPredbTypeId]);

  // 编辑已有连接时，加载其关联的层级路径
  useEffect(() => {
    if (!showTreePath || !connection?.id) return;
    setTreePathLoading(true);
    fetchHospitalByConnection(connection.id)
      .then((data) => {
        if (data?.platform) {
          setSelectedPlatformId(data.platform.id);
          // 需要等 predbTypes 加载后再设置 predbTypeId 和 districtId
          setTimeout(() => {
            if (data.predbType) setSelectedPredbTypeId(data.predbType.id);
            const district = data.district;
            if (district) {
              setTimeout(() => {
                setSelectedDistrictId(district.id);
              }, 100);
            }
            if (data.hospital) setHospitalName(data.hospital.name);
            setTreePathLoading(false);
          }, 200);
        } else {
          setTreePathLoading(false);
        }
      })
      .catch(() => setTreePathLoading(false));
  }, [showTreePath, connection?.id]);

  // 当 connection prop 变化时同步表单字段（解决组件复用导致显示旧值的问题）
  useEffect(() => {
    if (connection) {
      setName(connection.name);
      setDriver(connection.driver);
      setHost(connection.host);
      setPort(connection.port);
      setUsername(connection.username);
      setPassword(connection.password);
      setDatabase(connection.database);
      setSchema(connection.schema ?? '');
      setCustomDriverId(connection.customDriverId ?? '');
    } else {
      setName(defaultName ?? '');
      setDriver(DbDriver.MySQL);
      setHost('localhost');
      setPort(getDefaultPort(DbDriver.MySQL, ''));
      setUsername('');
      setPassword('');
      setDatabase('');
      setSchema('');
      setCustomDriverId('');
      // 重置层级选择
      setSelectedPlatformId('');
      setSelectedPredbTypeId('');
      setSelectedDistrictId('');
      setHospitalName('');
    }
    setTestResult(null);
    setTestError('');
    setSchemaOptions([]);
    setSchemasFetched(false);
  }, [connection?.id, defaultName]);

  // 当驱动类型变化时更新默认端口（仅用户手动切换时触发，跳过由上面 effect 引起的同步）
  const prevDriverKeyRef = React.useRef<string>(connection?.driver ?? DbDriver.MySQL);
  useEffect(() => {
    const currentKey = driver === DbDriver.Custom ? `custom-${customDriverId}` : driver;
    if (currentKey !== prevDriverKeyRef.current) {
      prevDriverKeyRef.current = currentKey;
      setPort(getDefaultPort(driver, customDriverId));
    }
  }, [driver, customDriverId]);

  const canLoadMeta = host.trim() && username.trim() && database.trim();

  const handleLoadSchemas = async () => {
    // 检测脱敏密码：编辑已有连接时密码为 ******，需要重新输入
    if (password === '******') {
      setTestResult('failed');
      setTestError('已保存的连接密码已脱敏，请重新输入密码后再刷新');
      return;
    }

    setLoadingSchemas(true);
    setTestResult(null);
    setTestError('');
    setSchemaOptions([]);
    setSchemasFetched(false);
    try {
      const schemas = await fetchSchemas({ driver, host, port, username, password, database, customDriverId });
      setSchemaOptions(schemas);
      setSchemasFetched(true);
      if (schemas.length > 0) {
        setTestResult('success');
      } else {
        setTestResult('failed');
        setTestError('连接成功，但未查询到任何 Schema，请确认数据库权限');
      }
    } catch (err: any) {
      setTestResult('failed');
      setTestError(translateConnectionError(err?.message ?? '未知错误', host, port));
      setSchemaOptions([]);
      setSchemasFetched(true);
    } finally {
      setLoadingSchemas(false);
    }
  };

  const handleDatabaseChange = (value: string) => {
    setDatabase(value);
    setSchema('');
    setSchemaOptions([]);
    setSchemasFetched(false);
    setTestResult(null);
  };

  /** 测试数据库连接是否可用 */
  const handleTestConnection = async () => {
    if (password === '******') {
      setTestResult('failed');
      setTestError('已保存的连接密码已脱敏，请重新输入密码后再测试');
      return;
    }
    if (!canLoadMeta) {
      setTestResult('failed');
      setTestError('请填写主机、用户名和数据库名');
      return;
    }
    setTestConnecting(true);
    setTestResult(null);
    setTestError('');
    try {
      const response = await (await import('../../services/apiClient')).apiFetch('/api/connections/test', {
        method: 'POST',
        body: JSON.stringify({ driver, host, port, username, password, database, customDriverId }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setTestResult('success');
      } else {
        setTestResult('failed');
        setTestError(translateConnectionError(data.error || '连接测试失败', host, port));
      }
    } catch (err: any) {
      setTestResult('failed');
      setTestError(translateConnectionError(err?.message || '连接测试失败', host, port));
    } finally {
      setTestConnecting(false);
    }
  };

  /** 将底层连接错误翻译为用户可操作的提示 */
  function translateConnectionError(raw: string, host: string, port: number): string {
    const msg = raw.toLowerCase();
    if (msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('拒绝连接')) {
      return `无法连接到 ${host}:${port}，请确认：\n1) 服务器是否运行\n2) 端口号是否正确\n3) 防火墙是否放行`;
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo') || msg.includes('no such host')) {
      return `无法解析主机名 "${host}"，请检查主机地址是否正确`;
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
      return `连接 ${host}:${port} 超时，请检查网络是否可达，或增加超时时间`;
    }
    if (msg.includes('authentication') || msg.includes('access denied') || msg.includes('password') || msg.includes('login')) {
      return `认证失败：用户名或密码错误，请检查登录凭据`;
    }
    if (msg.includes('unknown database') || msg.includes('database') && msg.includes('not exist')) {
      return `数据库不存在，请检查数据库名是否正确`;
    }
    if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
      return `SSL/TLS 连接失败，可能需要配置证书或关闭 SSL`;
    }
    return raw;
  }

  const handleOpenDriverUpload = () => {
    setPreUploadDriverIds(new Set(Object.keys(drivers)));
    setShowDriverUpload(true);
  };

  const handleDriverUploadClose = () => {
    setShowDriverUpload(false);
    const currentIds = Object.keys(drivers);
    const newId = currentIds.find((id) => !preUploadDriverIds.has(id));
    if (newId) {
      setCustomDriverId(newId);
    }
  };

  const handleSave = () => {
    const connData = {
      name,
      driver,
      host,
      port,
      username,
      password,
      database,
      schema: schema || undefined,
      status: ConnectionStatus.Online,
      customDriverId: driver === DbDriver.Custom ? customDriverId : undefined,
    };

    // 如果有关联回调且层级信息完整，走层级保存
    if (onSaveWithTree && selectedPlatformId && selectedPredbTypeId && selectedDistrictId) {
      onSaveWithTree(connData, {
        platformId: selectedPlatformId,
        predbTypeId: selectedPredbTypeId,
        districtId: selectedDistrictId,
        hospitalName: hospitalName.trim() || name,
      });
    } else {
      onSave(connData);
    }
  };

  const isValid =
    name.trim() && host.trim() && username.trim() && database.trim() &&
    (driver !== DbDriver.Custom || customDriverId.trim());

  // 层级必填校验（仅在显示层级选择时）
  const treePathValid = !showTreePath || (
    selectedPlatformId && selectedPredbTypeId && selectedDistrictId
  );

  // 项目切换时清空下级
  const handlePlatformChange = (val: string) => {
    setSelectedPlatformId(val);
    setSelectedPredbTypeId('');
    setSelectedDistrictId('');
  };

  const handlePredbTypeChange = (val: string) => {
    setSelectedPredbTypeId(val);
    setSelectedDistrictId('');
  };

  return (
    <Box sx={{ py: 1 }}>
      <Stack spacing={2}>
        <TextField
          label="连接名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="small"
          fullWidth
          required
        />
        <FormControl size="small" fullWidth required>
          <InputLabel>数据库类型</InputLabel>
          <Select
            value={driver === DbDriver.Custom ? customDriverId || DbDriver.Custom : driver}
            label="数据库类型"
            onChange={(e) => {
              const val = e.target.value as string;
              const builtInValues = [DbDriver.MySQL, DbDriver.PostgreSQL, DbDriver.Oracle, DbDriver.SQLServer];
              if (builtInValues.includes(val as DbDriver)) {
                setDriver(val as DbDriver);
                setCustomDriverId('');
              } else if (val === DbDriver.Custom) {
                setDriver(DbDriver.Custom);
              } else {
                setDriver(DbDriver.Custom);
                setCustomDriverId(val);
              }
            }}
          >
            <MenuItem value={DbDriver.MySQL}>MySQL</MenuItem>
            <MenuItem value={DbDriver.PostgreSQL}>PostgreSQL</MenuItem>
            <MenuItem value={DbDriver.Oracle}>Oracle</MenuItem>
            <MenuItem value={DbDriver.SQLServer}>SQL Server</MenuItem>
            {Object.values(drivers)
              .filter((d) => !d.isBuiltIn)
              .map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name} v{d.version}
                </MenuItem>
              ))}
          </Select>
        </FormControl>

        {/* 选中自定义驱动时显示驱动类名和上传按钮 */}
        {driver === DbDriver.Custom && customDriverId && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              label="驱动类名"
              value={drivers[customDriverId]?.driverClass || ''}
              size="small"
              fullWidth
              disabled
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudUploadIcon />}
              onClick={handleOpenDriverUpload}
              sx={{ mt: 0.5, textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              上传驱动
            </Button>
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="主机"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            size="small"
            sx={{ flex: 2 }}
            required
          />
          <TextField
            label="端口"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            size="small"
            type="number"
            sx={{ flex: 1 }}
          />
        </Box>
        <Button size="small" variant="text" startIcon={<DnsIcon />}
          onClick={() => setServerPickerOpen(true)}
          sx={{ textTransform: 'none', fontSize: '0.7rem', alignSelf: 'flex-start', color: 'text.secondary' }}>
          从服务器资源快速填充
        </Button>
        <TextField
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          size="small"
          fullWidth
          required
        />
        <TextField
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="small"
          type="password"
          fullWidth
        />

        {/* 数据库名 — 手动填写 */}
        <TextField
          label="数据库名"
          value={database}
          onChange={(e) => handleDatabaseChange(e.target.value)}
          size="small"
          fullWidth
          required
        />

        {/* 模式(Schema) — 支持手动输入 + 下拉选择 + 刷新 */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Autocomplete
            freeSolo
            size="small"
            fullWidth
            value={schema || null}
            onChange={(_e, newValue) => {
              setSchema(newValue ?? '');
            }}
            onInputChange={(_e, newInputValue) => {
              setSchema(newInputValue);
            }}
            options={schemaOptions}
            disabled={loadingSchemas || !database}
            loading={loadingSchemas}
            noOptionsText={
              !schemasFetched
                ? '请填写上方信息并点击刷新'
                : '未获取到 Schema，请检查数据库连接'
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="模式（Schema）"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingSchemas ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={loadingSchemas ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={handleLoadSchemas}
            disabled={loadingSchemas || !canLoadMeta}
            sx={{ mt: 0.5, textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            刷新
          </Button>
        </Box>

        {testResult && (
          <Alert severity={testResult === 'success' ? 'success' : 'error'}>
            {testResult === 'success'
              ? '连接成功！'
              : testError || '连接失败，请检查配置。'}
          </Alert>
        )}

        {/* ---- 层级树路径选择（仅在连接管理弹窗中显示） ---- */}
        {showTreePath && (
          <>
            <Divider />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AccountTreeIcon fontSize="small" color="action" />
              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                关联树节点（可选，保存后将在左侧树中创建对应连接实例）
              </Typography>
            </Box>

            <FormControl size="small" fullWidth>
              <InputLabel>项目</InputLabel>
              <Select
                value={selectedPlatformId}
                label="项目"
                onChange={(e) => handlePlatformChange(e.target.value)}
                disabled={treePathLocked || treePathLoading}
              >
                {platforms.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
                {platforms.length === 0 && (
                  <MenuItem disabled value="">暂无项目数据</MenuItem>
                )}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth disabled={!selectedPlatformId || treePathLocked || treePathLoading}>
              <InputLabel>业务模块</InputLabel>
              <Select
                value={selectedPredbTypeId}
                label="业务模块"
                onChange={(e) => handlePredbTypeChange(e.target.value)}
              >
                {predbTypes.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
                {predbTypes.length === 0 && (
                  <MenuItem disabled value="">{selectedPlatformId ? '暂无数据' : '请先选择项目'}</MenuItem>
                )}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth disabled={!selectedPredbTypeId || treePathLocked || treePathLoading}>
              <InputLabel>区域节点</InputLabel>
              <Select
                value={selectedDistrictId}
                label="区域节点"
                onChange={(e) => setSelectedDistrictId(e.target.value)}
              >
                {districts.map((d) => (
                  <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                ))}
                {districts.length === 0 && (
                  <MenuItem disabled value="">{selectedPredbTypeId ? '暂无数据' : '请先选择业务模块'}</MenuItem>
                )}
              </Select>
            </FormControl>

            <TextField
              label="连接实例名称"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              size="small"
              fullWidth
              helperText="默认使用连接名称，可自定义"
              disabled={treePathLocked}
            />
          </>
        )}

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleTestConnection}
            disabled={testConnecting || !canLoadMeta}
            sx={{ textTransform: 'none' }}
          >
            {testConnecting ? <CircularProgress size={14} sx={{ mr: 0.5 }} /> : null}
            测试连接
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              startIcon={<CancelIcon />}
              onClick={onCancel}
              sx={{ textTransform: 'none' }}
            >
              取消
            </Button>
            <Button
              size="small"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              variant="contained"
              disabled={!isValid || !treePathValid}
              sx={{ textTransform: 'none' }}
            >
              保存
            </Button>
          </Box>
        </Box>
      </Stack>

      <DriverUpload open={showDriverUpload} onClose={handleDriverUploadClose} />

      {/* 从服务器资源快速填充 */}
      <Dialog open={serverPickerOpen} onClose={() => setServerPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>选择服务器</DialogTitle>
        <DialogContent>
          {servers.length === 0 ? (
            <Typography variant="body2" color="text.secondary">暂无服务器记录</Typography>
          ) : (
            <List dense>
              {servers.map(s => (
                <ListItemButton key={s.id} onClick={() => {
                  setHost(s.internalIp);
                  if (s.username) setUsername(s.username);
                  setServerPickerOpen(false);
                }}>
                  <ListItemText
                    primary={s.name}
                    secondary={`${s.internalIp}${s.username ? ' / ' + s.username : ''}`}
                    primaryTypographyProps={{ fontSize: '0.85rem' }}
                    secondaryTypographyProps={{ fontSize: '0.7rem' }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default ConnectionForm;
