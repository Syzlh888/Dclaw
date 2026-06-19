export interface DriverPackage {
  id: string;
  /** 数据库类型名称，如 "Oracle"、"瀚高" */
  name: string;
  /** 版本号 */
  version: string;
  /** 驱动类名，如 "oracle.jdbc.OracleDriver" */
  driverClass: string;
  /** 上传文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** ISO 时间戳 */
  uploadTime: string;
  /** 关联的数据库类型标识，如 "oracle" */
  dbType: string;
  /** 可选描述 */
  description?: string;
  /** 是否为内置驱动（内置驱动不可删除） */
  isBuiltIn?: boolean;
}
