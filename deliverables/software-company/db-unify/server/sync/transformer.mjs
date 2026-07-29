/**
 * DClaw 临时导出的数据库类型和字段值转换。
 *
 * 类型名来自 information_schema/JDBC，不假定大小写或某一个数据库厂商的拼写；
 * 因此这里把五类数据库都归一化后再做映射。
 */

const DB_ALIASES = new Map([
  ['postgres', 'postgresql'], ['postgresql', 'postgresql'], ['pg', 'postgresql'],
  ['mysql', 'mysql'], ['mariadb', 'mysql'],
  ['highgo', 'highgo'], ['瀚高', 'highgo'], ['hgdb', 'highgo'],
  ['达梦', 'dameng'], ['dameng', 'dameng'], ['dm', 'dameng'],
  ['金仓', 'kingbase'], ['kingbase', 'kingbase'], ['kingbasees', 'kingbase'],
]);

const PG_TYPES = {
  boolean: 'BOOLEAN', bool: 'BOOLEAN', bit: 'BOOLEAN',
  smallint: 'SMALLINT', int2: 'SMALLINT', tinyint: 'SMALLINT',
  integer: 'INTEGER', int: 'INTEGER', int4: 'INTEGER', mediumint: 'INTEGER',
  bigint: 'BIGINT', int8: 'BIGINT',
  decimal: 'NUMERIC', numeric: 'NUMERIC', number: 'NUMERIC', money: 'NUMERIC',
  real: 'REAL', float: 'REAL', float4: 'REAL',
  'double precision': 'DOUBLE PRECISION', double: 'DOUBLE PRECISION', float8: 'DOUBLE PRECISION',
  char: 'CHAR', character: 'CHAR', varchar: 'VARCHAR', 'character varying': 'VARCHAR',
  text: 'TEXT', tinytext: 'TEXT', mediumtext: 'TEXT', longtext: 'TEXT',
  date: 'DATE', time: 'TIME', 'time without time zone': 'TIME', 'time with time zone': 'TIME WITH TIME ZONE',
  datetime: 'TIMESTAMP', timestamp: 'TIMESTAMP', 'timestamp without time zone': 'TIMESTAMP',
  timestamptz: 'TIMESTAMP WITH TIME ZONE', 'timestamp with time zone': 'TIMESTAMP WITH TIME ZONE',
  json: 'JSONB', jsonb: 'JSONB', uuid: 'UUID',
  bytea: 'BYTEA', blob: 'BYTEA', tinyblob: 'BYTEA', mediumblob: 'BYTEA', longblob: 'BYTEA', binary: 'BYTEA', varbinary: 'BYTEA',
  enum: 'TEXT', set: 'TEXT', xml: 'TEXT', clob: 'TEXT', nclob: 'TEXT',
};

const MYSQL_TYPES = {
  ...PG_TYPES,
  boolean: 'TINYINT', bool: 'TINYINT', bit: 'TINYINT',
  smallint: 'SMALLINT', tinyint: 'TINYINT', mediumint: 'INT', integer: 'INT', int: 'INT',
  bigint: 'BIGINT', decimal: 'DECIMAL', numeric: 'DECIMAL', number: 'DECIMAL',
  real: 'FLOAT', float: 'FLOAT', 'double precision': 'DOUBLE', double: 'DOUBLE',
  'character varying': 'VARCHAR', text: 'TEXT', json: 'JSON', jsonb: 'JSON',
  timestamp: 'DATETIME', 'timestamp without time zone': 'DATETIME',
  'timestamp with time zone': 'DATETIME', bytea: 'LONGBLOB',
};

const TYPE_MAP = {
  postgresql: PG_TYPES,
  highgo: PG_TYPES,
  kingbase: PG_TYPES,
  dameng: {
    ...PG_TYPES,
    boolean: 'NUMBER(1)', bool: 'NUMBER(1)', json: 'CLOB', jsonb: 'CLOB',
    bytea: 'BLOB', timestamptz: 'TIMESTAMP WITH TIME ZONE',
  },
  mysql: MYSQL_TYPES,
};

const BINARY_RE = /(blob|binary|varbinary|bytea|raw|image|longvarbinary)/i;
const JSON_RE = /(^|\W)(json|jsonb|clob|nclob)(\W|$)/i;
const DATE_RE = /(date|time|timestamp|datetime)/i;

export function normalizeDbType(dbType) {
  const raw = String(dbType || '').trim().toLowerCase();
  if (!raw) return 'postgresql';
  for (const [alias, normalized] of DB_ALIASES) {
    if (raw === alias || raw.includes(alias.toLowerCase())) return normalized;
  }
  return raw;
}

function splitType(type) {
  const raw = String(type || 'text').trim().toLowerCase();
  const match = raw.match(/^([a-z][a-z0-9 _]*?)(?:\s*\(([^)]*)\))?$/i);
  return { base: (match?.[1] || raw).trim(), args: match?.[2] || '' };
}

/** 将源数据库类型转换为目标数据库的 DDL 类型。 */
export function convertType(sourceDbType, sourceColumnType, targetDbType) {
  const { base, args } = splitType(sourceColumnType);
  const targetTypes = TYPE_MAP[normalizeDbType(targetDbType)] || PG_TYPES;
  let target = targetTypes[base];
  if (!target) {
    if (BINARY_RE.test(base)) target = targetTypes.blob || 'BYTEA';
    else if (JSON_RE.test(base)) target = targetTypes.json || 'JSONB';
    else if (DATE_RE.test(base)) target = targetTypes.timestamp || 'TIMESTAMP';
    else if (/char|text|clob|xml|citext/.test(base)) target = 'TEXT';
    else if (/bool/.test(base)) target = targetTypes.boolean || 'BOOLEAN';
    else if (/int|serial/.test(base)) target = 'INTEGER';
    else if (/real|float|double/.test(base)) target = 'DOUBLE PRECISION';
    else if (/numeric|decimal|number/.test(base)) target = 'NUMERIC';
    else target = 'TEXT';
  }

  // 保留常用的字符长度和数值 precision/scale；对于 TEXT/JSON/BLOB 等不追加长度。
  if (args && /^(VARCHAR|CHAR|CHARACTER|DECIMAL|NUMERIC|NUMBER)$/i.test(target)) {
    return `${target}(${args})`;
  }
  if (target === 'VARCHAR' && args) return `${target}(${args})`;
  return target;
}

/** 自动按列生成可编辑的字段映射。 */
export function buildFieldMappings(sourceColumns = [], sourceDbType, targetDbType) {
  return sourceColumns.map((column, index) => {
    const sourceName = column.name ?? column.column_name ?? column.sourceName ?? `column_${index + 1}`;
    const sourceType = column.type ?? column.data_type ?? column.sourceType ?? 'text';
    const targetName = column.targetName ?? column.targetColumn ?? sourceName;
    return {
      sourceName,
      targetName,
      sourceColumn: sourceName,
      targetColumn: targetName,
      sourceType,
      targetType: column.targetType || convertType(sourceDbType, sourceType, targetDbType),
      nullable: column.nullable !== false,
      primaryKey: Boolean(column.primaryKey || column.primary_key),
      length: column.length ?? column.character_maximum_length ?? null,
      precision: column.precision ?? column.numeric_precision ?? null,
      scale: column.scale ?? column.numeric_scale ?? null,
      default: column.default ?? column.column_default ?? null,
      comment: column.comment || '',
    };
  });
}

function formatDate(value, targetType) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = date.toISOString();
  if (/^date$/i.test(String(targetType || '').trim())) return iso.slice(0, 10);
  // 数据库写入时使用没有 T/Z 的 timestamp，避免驱动二次转换时改变时区。
  if (/^time/i.test(String(targetType || '').trim()) && !/timestamp/i.test(String(targetType || ''))) {
    return iso.slice(11, 23);
  }
  return iso.replace('T', ' ').replace(/Z$/, '');
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** 将一项值转换为目标列可接收的值。文件导出也使用此函数。 */
export function transformValue(value, sourceColumnType, targetColumnType) {
  if (value === null || value === undefined) return null;
  const sourceType = String(sourceColumnType || '').toLowerCase();
  const targetType = String(targetColumnType || '').toLowerCase();

  if (BINARY_RE.test(sourceType) || BINARY_RE.test(targetType)) {
    const buffer = Buffer.isBuffer(value)
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value)
        : Buffer.from(String(value), /^[0-9a-f]+$/i.test(String(value)) ? 'hex' : 'utf8');
    return BINARY_RE.test(targetType) ? buffer : buffer.toString('base64');
  }

  if (JSON_RE.test(sourceType) || JSON_RE.test(targetType)) {
    const parsed = parseJson(value);
    return JSON_RE.test(targetType) ? parsed : JSON.stringify(parsed);
  }

  if (DATE_RE.test(sourceType) || DATE_RE.test(targetType)) {
    return formatDate(value, targetType);
  }

  if (/bool|boolean/i.test(targetType)) {
    if (typeof value === 'string') return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
    return Boolean(value);
  }
  if (/^(tinyint|smallint|integer|int|bigint|number)/i.test(targetType) && typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

export function quoteIdentifier(name, quote = '"') {
  const value = String(name || '');
  if (!value || value.includes('\0') || value.includes('.')) throw new Error(`非法标识符: ${value}`);
  const escaped = value.replaceAll(quote, quote + quote);
  return `${quote}${escaped}${quote}`;
}

export function splitQualifiedName(name, fallbackSchema = '') {
  const parts = String(name || '').split('.').filter(Boolean);
  if (parts.length > 2) throw new Error(`非法限定表名: ${name}`);
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  return { schema: fallbackSchema || '', table: parts[0] || '' };
}

export function valueToText(value) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function toSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString('hex')}'`;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof Date) value = value.toISOString().replace('T', ' ').replace(/Z$/, '');
  if (typeof value === 'object') value = JSON.stringify(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

export { TYPE_MAP };
