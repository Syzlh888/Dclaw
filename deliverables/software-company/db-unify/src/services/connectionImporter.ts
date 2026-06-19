import Papa from 'papaparse';
import type { DbConnection } from '../types/connection';

export interface ParsedConnection {
  name: string;
  driver: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema?: string;
}

export function parseCsvConnections(csvText: string): { connections: ParsedConnection[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const errors: string[] = [];
  const connections: ParsedConnection[] = [];

  result.data.forEach((row, index) => {
    const name = row['名称'] || row['name'] || '';
    const driver = row['驱动'] || row['driver'] || 'mysql';
    const host = row['主机'] || row['host'] || '';
    const port = parseInt(row['端口'] || row['port'] || '3306', 10);
    const username = row['用户名'] || row['username'] || '';
    const password = row['密码'] || row['password'] || '';
    const database = row['数据库'] || row['database'] || '';
    const schema = row['模式'] || row['schema'] || '';

    if (!name || !host) {
      errors.push(`第 ${index + 1} 行：名称和主机不能为空`);
      return;
    }

    connections.push({ name, driver, host, port, username, password, database, schema });
  });

  return { connections, errors };
}

export function parseJsonConnections(jsonText: string): { connections: ParsedConnection[]; errors: string[] } {
  const errors: string[] = [];
  const connections: ParsedConnection[] = [];

  try {
    const data = JSON.parse(jsonText);
    const arr = Array.isArray(data) ? data : [data];

    arr.forEach((item: any, index: number) => {
      const name = item.name || item['名称'] || '';
      const driver = item.driver || item['驱动'] || 'mysql';
      const host = item.host || item['主机'] || '';
      const port = parseInt(String(item.port || item['端口'] || '3306'), 10);
      const username = item.username || item['用户名'] || '';
      const password = item.password || item['密码'] || '';
      const database = item.database || item['数据库'] || '';
      const schema = item.schema || item['模式'] || '';

      if (!name || !host) {
        errors.push(`条目 ${index + 1}：名称和主机不能为空`);
        return;
      }

      connections.push({ name, driver, host, port, username, password, database, schema });
    });
  } catch {
    errors.push('JSON 格式解析失败');
  }

  return { connections, errors };
}
