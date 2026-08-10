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
  IconButton,
  InputAdornment,
} from '@mui/material';
import { DbDriver, ConnectionStatus } from '../../types/connection';
import type { DbConnection } from '../../types/connection';
import { useDriverStore } from '../../stores/driverStore';
import { fetchSchemas } from '../../services/connectionService';
import { fetchPlatforms, fetchPredbTypes, fetchDistricts, fetchHospitalByConnection } from '../../services/treeService';
import { fetchAllDbInstances, decryptDbInstanceCredential } from '../../services/serverService';
import { apiFetch } from '../../services/apiClient';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DnsIcon from '@mui/icons-material/Dns';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
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
  const [dbInstances, setDbInstances] = useState<any[]>([]);
  const [loadingDbInstances, setLoadingDbInstances] = useState(false);

  // ---- 凭据选择器状态 ----
  const [credentialPickerOpen, setCredentialPickerOpen] = useState(false);
  const [pendingDbInstance, setPendingDbInstance] = useState<any>(null);
  const [decryptingPwd, setDecryptingPwd] = useState(false);
  const [dbTypeWarning, setDbTypeWarning] = useState('');

  const getDefaultPort = (drv: DbDriver, cid?: string): number => {
    switch (drv) {
      case DbDriver.MySQL: return 3306;
      case DbDriver.MariaDB: return 3306;
      case DbDriver.PostgreSQL: return 5432;
      case DbDriver.Oracle: return 1521;
      case DbDriver.SQLServer: return 1433;
      case DbDriver.HighGo: return 5866;
      case DbDriver.Kingbase: return 54321;
      case DbDriver.Dameng: return 5236;
      case DbDriver.DB2: return 50000;
      case DbDriver.H2: return 9092;
      case DbDriver.SQLite: return 0;
      default: {
        if (cid && drivers[cid]) {
          const dt = drivers[cid].dbType.toLowerCase();
          if (dt === 'mysql' || dt === 'mariadb') return 3306;
          if (dt === 'postgresql') return 5432;
          if (dt === 'highgo' || dt.includes('瀚高')) return 5866;
          if (dt === 'oracle') return 1521;
          if (dt === 'sqlserver') return 1433;
          if (dt === 'kingbase' || dt.includes('金仓')) return 54321;
          if (dt === 'dameng' || dt.includes('达梦')) return 5236;
          if (dt === 'db2') return 50000;
          if (dt === 'h2') return 9092;
          if (dt === 'sqlite') return 0;
        }
        return 5432;
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
  const [showPwd, setShowPwd] = useState(false);

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

  // 当驱动类型变化时更新默认端口（仅用户手动切换时触发）
  const getDriverKey = (drv: DbDriver, cid: string = '') =>
    drv === DbDriver.Custom ? `custom-${cid}` : drv;
  const prevDriverKeyRef = React.useRef<string>(
    getDriverKey(connection?.driver ?? DbDriver.MySQL, connection?.customDriverId)
  );
  useEffect(() => {
    const currentKey = getDriverKey(driver, customDriverId);
    if (currentKey !== prevDriverKeyRef.current) {
      prevDriverKeyRef.current = currentKey;
      setPort(getDefaultPort(driver, customDriverId));
    }
  }, [driver, customDriverId]);

  // ---- 服务器资源数据库实例加载 ----
  useEffect(() => {
    if (!serverPickerOpen) return;
    setLoadingDbInstances(true);
    setDbTypeWarning('');
    fetchAllDbInstances()
      .then((list) => {
        setDbInstances(list);
        setLoadingDbInstances(false);
      })
      .catch(() => {
        setDbInstances([]);
        setLoadingDbInstances(false);
      });
  }, [serverPickerOpen]);

  /** 将服务器资源的 dbType 字符串映射为 DbDriver 枚举 */
  const mapDbTypeToDriver = (dbType: string): DbDriver => {
    const t = dbType.toLowerCase();
    if (t.includes('mariadb')) return DbDriver.MariaDB;
    if (t.includes('mysql')) return DbDriver.MySQL;
    if (t.includes('highgo') || t.includes('瀚高')) return DbDriver.HighGo;
    if (t.includes('postgres') || t.includes('pg')) return DbDriver.PostgreSQL;
    if (t.includes('oracle')) return DbDriver.Oracle;
    if (t.includes('sqlserver') || t.includes('sql server') || t.includes('mssql')) return DbDriver.SQLServer;
    if (t.includes('sqlite')) return DbDriver.SQLite;
    if (t.includes('kingbase') || t.includes('金仓')) return DbDriver.Kingbase;
    if (t.includes('dameng') || t.includes('达梦')) return DbDriver.Dameng;
    if (t.includes('db2')) return DbDriver.DB2;
    if (t.includes('h2')) return DbDriver.H2;
    return DbDriver.MySQL; // 默认
  };

  /** 从数据库实例的凭据填充连接表单 */
  const fillFromDbInstance = async (di: any, credentialIndex: number) => {
    setDecryptingPwd(true);
    setCredentialPickerOpen(false);
    setDbTypeWarning('');
    try {
      // 解密凭据
      const decrypted = await decryptDbInstanceCredential(di.id, credentialIndex);
      const drv = mapDbTypeToDriver(di.dbType);
      // 连接名优先用 credential 的 connectionName
      setName(decrypted.connectionName || `${di.serverName} - ${di.dbName}`);
      setDriver(drv);
      setHost(di.internalIp || '');
      setPort(di.port || getDefaultPort(drv, ''));
      setUsername(decrypted.username || '');
      setPassword(decrypted.password || '');
      setDatabase(di.dbName);
      setSchema(decrypted.schema || di.schema || '');
      setCustomDriverId('');
      setServerPickerOpen(false);
      // 数据库类型匹配检查
      const t = (di.dbType || '').toLowerCase();
      const known = ['mysql','mariadb','postgresql','postgres','highgo','瀚高',
        'oracle','sqlserver','sql server','mssql','pg','sqlite','kingbase','金仓',
        'dameng','达梦','db2','h2'];
      if (!known.some(k => t.includes(k))) {
        setDbTypeWarning(`服务器资源库类型为「${di.dbType}」，未匹配到已知数据库类型，请手动确认下方「数据库类型」是否正确`);
      }
    } catch (err: any) {
      console.error('解密凭据失败:', err);
      // 解密失败时至少填充基本信息，密码留空
      const drv = mapDbTypeToDriver(di.dbType);
      const primaryUser = di.credentials?.[credentialIndex]?.username || di.username || '';
      setName(primaryUser ? `${di.serverName} - ${di.dbName} (${primaryUser})` : `${di.serverName} - ${di.dbName}`);
      setDriver(drv);
      setHost(di.internalIp || '');
      setPort(di.port || getDefaultPort(drv, ''));
      setUsername(primaryUser);
      setPassword('');
      setDatabase(di.dbName);
      setSchema(di.schema || '');
      setCustomDriverId('');
      setServerPickerOpen(false);
    } finally {
      setDecryptingPwd(false);
    }
  };

  const canLoadMeta = host.trim() && username.trim() && database.trim();

  const handleLoadSchemas = async () => {
    // 脱敏密码：编辑已有连接时使用服务器端 Schema 查询（后端从数据库读取真实密码）
    if (connection?.id && password === '******') {
      setLoadingSchemas(true);
      setTestResult(null);
      setTestError('');
      setSchemaOptions([]);
      setSchemasFetched(false);
      try {
        const response = await apiFetch(`/api/connection/${connection.id}/schemas`, {
          method: 'POST',
        });
        if (response.ok) {
          const data = await response.json();
          const schemas: string[] = data.schemas || [];
          setSchemaOptions(schemas);
          setSchemasFetched(true);
          if (schemas.length > 0) {
            setTestResult('success');
          } else {
            setTestResult('failed');
            setTestError('连接成功，但未查询到任何 Schema，请确认数据库权限');
          }
        } else {
          const err = await response.json().catch(() => ({ error: 'Schema 查询失败' }));
          setTestResult('failed');
          setTestError(translateConnectionError(err.error || 'Schema 查询失败', host, port));
          setSchemasFetched(true);
        }
      } catch (err: any) {
        setTestResult('failed');
        setTestError(translateConnectionError(err?.message ?? '未知错误', host, port));
        setSchemaOptions([]);
        setSchemasFetched(true);
      } finally {
        setLoadingSchemas(false);
      }
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
    if (connection?.id && password === '******') {
      // 编辑已有连接且未改密码 -> 使用服务器端测试（后端有真实密码）
      setTestConnecting(true);
      setTestResult(null);
      setTestError('');
      try {
        const resp = await apiFetch(`/api/connections/${connection.id}/test`, { method: 'POST' });
        if (resp.ok) {
          setTestResult('success');
        } else {
          const data = await resp.json().catch(() => ({}));
          setTestResult('failed');
          setTestError(data.error || '连接测试失败');
        }
      } catch (err: any) {
        setTestResult('failed');
        setTestError(err.message || '网络错误');
      } finally {
        setTestConnecting(false);
      }
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
      const response = await apiFetch('/api/connections/test', {
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
        {/* 从服务器资源快速填充 — 放在页面最上面 */}
        <Button size="small" variant="outlined" startIcon={<DnsIcon />}
          onClick={() => setServerPickerOpen(true)}
          sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
          从服务器资源快速填充
        </Button>
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
              const builtInValues = [DbDriver.MySQL, DbDriver.PostgreSQL, DbDriver.Oracle, DbDriver.SQLServer, DbDriver.MariaDB, DbDriver.SQLite, DbDriver.HighGo, DbDriver.Kingbase, DbDriver.Dameng, DbDriver.DB2, DbDriver.H2];
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
            <MenuItem value={DbDriver.MariaDB}>MariaDB</MenuItem>
            <MenuItem value={DbDriver.PostgreSQL}>PostgreSQL</MenuItem>
            <MenuItem value={DbDriver.Oracle}>Oracle</MenuItem>
            <MenuItem value={DbDriver.SQLServer}>SQL Server</MenuItem>
            <MenuItem value={DbDriver.SQLite}>SQLite</MenuItem>
            <MenuItem value={DbDriver.HighGo}>HighGo (瀚高)</MenuItem>
            <MenuItem value={DbDriver.Kingbase}>Kingbase (金仓)</MenuItem>
            <MenuItem value={DbDriver.Dameng}>Dameng (达梦)</MenuItem>
            <MenuItem value={DbDriver.DB2}>DB2</MenuItem>
            <MenuItem value={DbDriver.H2}>H2</MenuItem>
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
        {/* 数据库类型警告提示 */}
        {dbTypeWarning && (
          <Alert severity="warning" onClose={() => setDbTypeWarning('')} sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
            {dbTypeWarning}
          </Alert>
        )}
        <TextField
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          size="small"
          fullWidth
          required
          autoComplete="off"
          inputProps={{ autoComplete: 'new-password', 'data-lpignore': 'true', 'data-form-type': 'other' }}
          name={`db-user-${Math.random().toString(36).slice(2, 8)}`}
        />
        <TextField
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="small"
          type={showPwd ? 'text' : 'password'}
          fullWidth
          autoComplete="new-password"
          inputProps={{ autoComplete: 'new-password', 'data-lpignore': 'true', 'data-form-type': 'other' }}
          name={`db-pwd-${Math.random().toString(36).slice(2, 8)}`}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShowPwd(!showPwd)} sx={{ p: 0.25 }}>
                  {showPwd ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
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

      {/* 从服务器资源快速填充 — 所有数据库实例扁平列表 */}
      <Dialog open={serverPickerOpen} onClose={() => setServerPickerOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { maxHeight: '70vh' } }}>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          选择数据库实例
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {dbInstances.length} 个实例
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loadingDbInstances ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <List dense disablePadding>
              {dbInstances.map(di => {
                const primaryUser = di.credentials?.[0]?.username || di.username || '';
                return (
                  <ListItemButton
                    key={di.id}
                    sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
                    onClick={() => {
                      const creds = di.credentials || [];
                      if (creds.length === 0) {
                        const drv = mapDbTypeToDriver(di.dbType);
                        setName(`${di.serverName} - ${di.dbName}`);
                        setDriver(drv);
                        setHost(di.internalIp || '');
                        setPort(di.port || getDefaultPort(drv, ''));
                        setUsername(di.username || '');
                        setPassword('');
                        setDatabase(di.dbName);
                        setSchema(di.schema || '');
                        setCustomDriverId('');
                        setServerPickerOpen(false);
                      } else if (creds.length === 1) {
                        fillFromDbInstance(di, 0);
                      } else {
                        setPendingDbInstance(di);
                        setCredentialPickerOpen(true);
                      }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {di.dbType.toUpperCase()}
                          </Typography>
                          <Typography variant="body2" fontWeight={500}>{di.dbName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            :{di.port}
                          </Typography>
                          {di.schema && (
                            <Typography variant="caption" color="text.disabled">
                              ({di.schema})
                            </Typography>
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            {di.internalIp || di.externalIp || '无IP'}
                          </Typography>
                          <Typography variant="caption" color="text.disabled">·</Typography>
                          <Typography variant="caption" color="text.disabled">{di.serverName}</Typography>
                          {primaryUser && (
                            <>
                              <Typography variant="caption" color="text.disabled">·</Typography>
                              <Typography variant="caption" color="text.disabled">@ {primaryUser}</Typography>
                            </>
                          )}
                          {di.credentials && di.credentials.length > 1 && (
                            <>
                              <Typography variant="caption" color="text.disabled">·</Typography>
                              <Typography variant="caption" color="info.main">+{di.credentials.length - 1}</Typography>
                            </>
                          )}
                        </Box>
                      }
                      primaryTypographyProps={{ fontSize: '0.85rem' }}
                      secondaryTypographyProps={{ fontSize: '0.7rem' }}
                    />
                  </ListItemButton>
                );
              })}
              {dbInstances.length === 0 && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">暂无数据库实例</Typography>
                </Box>
              )}
            </List>
          )}
        </DialogContent>
      </Dialog>

      {/* 凭据选择器：多个凭据时让用户选哪个 */}
      <Dialog open={credentialPickerOpen} onClose={() => !decryptingPwd && setCredentialPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          {decryptingPwd ? '解密中...' : '选择凭据'}
        </DialogTitle>
        <DialogContent>
          {decryptingPwd ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <List dense>
              {(pendingDbInstance?.credentials || []).map((cred: any, idx: number) => (
                <ListItemButton key={idx} onClick={() => fillFromDbInstance(pendingDbInstance, idx)}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {cred.connectionName || cred.username || `凭据 ${idx + 1}`}
                        </Typography>
                        {cred.schema && (
                          <Typography variant="caption" color="text.secondary">
                            ({cred.schema})
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.disabled">
                        {cred.username}{cred.notes ? ` · ${cred.notes}` : ''}{cred.region ? ` · ${cred.region}` : ''}
                      </Typography>
                    }
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
