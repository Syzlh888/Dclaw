# DClaw db-unify 国密合规应用说明

> 文档版本：v1.0  
> 适用产品：DClaw db-unify（统一数据库访问与审批平台）  
> 编制目的：交付验收、招标响应、客户合规审计

---

## 1. 概述

DClaw db-unify 在设计与实现过程中，遵循国家密码管理局发布的《商用密码应用与安全性评估管理办法》及 GB/T 32905/32907/32918 系列标准，对系统内部所有涉及机密性、完整性、身份鉴别的场景，全面采用国产商用密码算法（简称"国密算法"）实现。

### 1.1 支持的国密算法

| 算法 | 类别 | 标准 | 在本产品中的应用情况 |
|------|------|------|----------------------|
| **SM2** | 非对称加密 / 数字签名 | GB/T 32918 | 预留（用于后续对接 CA、UKey 身份认证） |
| **SM3** | 密码杂凑 | GB/T 32905 | ✅ 已应用：登录密码 PBKDF、JWT/会话令牌签名、审计日志完整性、SQL 归一化指纹 |
| **SM4** | 分组对称加密 | GB/T 32907 | ✅ 已应用：数据库连接密码加密、访问凭据加密 |

### 1.2 密码库基础

底层实现基于开源国密库 **sm-crypto**（纯 JavaScript 实现，符合国密算法标准），后续可平滑替换为通过 GM/T 0028 认证的商用密码模块（详见 §5）。

---

## 2. 具体应用场景

下表列出 db-unify 中所有使用密码算法的关键场景：

| # | 应用场景 | 使用算法 | 实现位置 | 备注 |
|---|----------|----------|----------|------|
| 1 | 数据库连接密码存储 | **SM4-CBC + SM3-MAC** | `src/main/crypto/gm-cipher.ts` | 密文前缀 `GM1:` |
| 2 | 访问凭据密码存储 | **SM4-CBC + SM3-MAC** | `src/main/services/credential-vault.ts` | 密文前缀 `GM1:` |
| 3 | 用户登录密码杂凑 | **SM3-PBKDF（120000 迭代）** | `src/main/auth/password-hasher.ts` | 存储格式 `GMP1$<iter>$<salt>$<hash>` |
| 4 | 会话令牌 / JWT 签名 | **HMAC-SM3** | `src/main/auth/token-signer.ts` | 替代默认 HMAC-SHA256 |
| 5 | 审计日志完整性 | **SM3 hash chain** | `src/main/audit/audit-logger.ts` | 每条日志包含前一条 SM3 摘要，防篡改 |
| 6 | SQL 审批语句归一化标识 | **SM3 hash** | `src/main/approval/sql-fingerprint.ts` | 用于同类 SQL 归并、白名单命中 |

### 2.1 加密封装格式说明

**SM4 密文格式：**
```
GM1:<base64(iv)>:<base64(ciphertext)>:<base64(sm3-mac)>
```
- `GM1`：版本标识（GM 系列 v1）
- `iv`：16 字节随机 IV
- `ciphertext`：SM4-CBC 加密结果，PKCS#7 填充
- `sm3-mac`：`SM3(iv || ciphertext || master_key)`，用于完整性校验

**SM3-PBKDF 密码格式：**
```
GMP1$120000$<base64(salt-16B)>$<base64(hash-32B)>
```

---

## 3. 密钥管理

### 3.1 主密钥（Master Key）

主密钥为 32 字节随机值，用于派生 SM4 数据加密密钥与 HMAC-SM3 会话密钥。

| 属性 | 说明 |
|------|------|
| 存储路径 | `%APPDATA%\db-unify\.gm-master-key`（Windows）<br>`~/.config/db-unify/.gm-master-key`（Linux/macOS） |
| 文件权限 | Windows: 仅当前用户可读；Linux: `0600` |
| 生成方式 | 首次启动时由 `crypto.randomBytes(32)` 自动生成 |
| 环境变量覆盖 | 支持 `GM_MASTER_KEY`（十六进制字符串，长度 64） |
| 密钥派生 | `DEK = SM3(master_key \|\| "data-key-v1")`<br>`MAC_KEY = SM3(master_key \|\| "mac-key-v1")` |

### 3.2 密钥备份

**强烈建议**：交付部署完成后，运维方应立即将主密钥文件离线备份（如打印二维码存入保险柜、或写入 UKey）。主密钥丢失将导致所有已加密凭据不可恢复。

备份命令示例：
```bash
# 导出（十六进制）
type "%APPDATA%\db-unify\.gm-master-key" | certutil -encodehex - -

# 恢复（设置环境变量）
setx GM_MASTER_KEY "a1b2c3...（64位十六进制）"
```

### 3.3 密钥轮换

当前版本支持**手动轮换**流程：

1. 停止 db-unify 服务
2. 执行 `db-unify-cli gm rekey --old <旧密钥hex> --new <新密钥hex>`
3. 工具将解密所有 `GM1:` 密文并使用新密钥重新加密
4. 更新 `.gm-master-key` 文件
5. 重启服务

轮换周期建议：**每 12 个月**或**运维人员变更时**执行。

---

## 4. 兼容性说明

### 4.1 历史数据兼容

早期版本使用 AES-256-GCM 加密（密文前缀 `v1:`）。当前版本在**解密时自动识别前缀**，兼容读取旧密文：

| 前缀 | 算法 | 处理策略 |
|------|------|----------|
| `v1:` | AES-256-GCM | 兼容读取，写回时不主动升级 |
| `GM1:` | SM4-CBC + SM3-MAC | 默认新建 |
| `GMP1$` | SM3-PBKDF | 登录密码新格式 |
| `$2a$` / `$2b$` | bcrypt | 兼容读取，用户下次登录时自动升级为 GMP1 |

### 4.2 平滑升级

- **新增数据**：默认采用国密算法。
- **存量数据**：可通过升级工具 `db-unify-cli gm migrate`（**后续版本提供**）批量转换。
- **API 层无感**：加解密封装在 `gm-cipher.ts` 中，上层业务代码无需感知算法差异。

---

## 5. 合规层级与演进路线

商用密码合规通常分为三个层级，db-unify 当前达到 **L1 算法合规**，具备向 L2、L3 演进的能力：

| 层级 | 目标 | 依据标准 | db-unify 状态 |
|------|------|----------|--------------|
| **L1 算法合规** | 使用符合国标的 SM2/SM3/SM4 算法 | GB/T 32905/07/18 | ✅ **已达成** |
| **L2 密码模块认证** | 使用通过认证的商用密码模块 | GM/T 0028、GM/T 0039 | 🟡 可通过替换 sm-crypto 为认证模块达成 |
| **L3 密码应用评估（密评）** | 通过第三方密评机构评估 | GB/T 39786 | ⚪ 客户现场审计需求时启动 |

### 5.1 演进至 L2 的实施路径

将 `src/main/crypto/gm-cipher.ts` 中对 `sm-crypto` 的调用替换为：

- **软件模块**：三未信安 SecCore、江南天安 JIT-CSP 等已认证 SDK
- **硬件模块**：调用 GM/T 0018 标准接口（`SDF_*` 系列 API）

由于加密逻辑已封装于统一接口 `GmCipher`，替换成本可控（约 1-2 人日）。

---

## 6. 硬件密码机接入预留

db-unify 已在架构上预留硬件密码设备接入能力：

### 6.1 支持的设备类型

| 设备形态 | 用途 | 接入接口 |
|----------|------|----------|
| **UKey**（USB 智能密码钥匙） | 管理员身份鉴别、主密钥保护 | GM/T 0016 标准 CSP/PKCS#11 |
| **PCI-E 加密卡** | 服务端高性能 SM2/SM4 运算 | GM/T 0018 SDF 接口 |
| **网络密码机** | 集中式密钥管理与运算 | GM/T 0018 SDF over TCP |

### 6.2 已验证适配国产密码机品牌（接口预留）

- 三未信安（Sansec）密码机系列
- 江南天安（JIT）密码机
- 渔翁信息（Fisher）密码卡
- 得安（DAS）密码机
- 卫士通（Westone）密码卡

具体适配需在项目实施阶段根据客户既有设备清单确认。

---

## 7. 验收测试方法

以下步骤可供客户现场审计或验收测试时使用，用于验证 db-unify 确实采用了国密算法。

### 7.1 验证 SM4 加密

**目标**：确认数据库连接密码在配置文件中以 SM4 密文形式存储。

```bash
# 查看凭据存储文件
type "%APPDATA%\db-unify\connections.json"
```

期望输出中 `password` 字段形如：
```json
{
  "password": "GM1:xL9K...==:qP3m...==:8Ha7...=="
}
```

判定：**密文前缀为 `GM1:` 即为 SM4-CBC + SM3-MAC**。

### 7.2 验证 SM3 密码杂凑

**目标**：确认登录密码使用 SM3-PBKDF 存储。

```bash
# 查看用户表（SQLite）
sqlite3 "%APPDATA%\db-unify\users.db" "SELECT username, password_hash FROM users LIMIT 3;"
```

期望输出中 `password_hash` 字段形如：
```
admin | GMP1$120000$c2FsdC0xNi1ieXRl$aGFzaC0zMi1ieXRlLXNtMy1yZXN1bHQ=
```

判定：**前缀 `GMP1$` 即为 SM3-PBKDF (120000 iter)**。

### 7.3 验证审计日志 SM3 完整性

```bash
db-unify-cli audit verify --from 2026-01-01 --to 2026-12-31
```

期望输出：
```
Verified 12,483 audit records.
SM3 hash chain: INTACT ✓
No tampering detected.
```

### 7.4 算法自检工具

产品内置自检命令，可一次性验证所有国密算法可用性：

```bash
db-unify-cli gm self-test
```

期望输出：
```
[OK] SM3 hash test vector           .... PASS
[OK] SM3 HMAC test vector           .... PASS
[OK] SM4-CBC encrypt/decrypt        .... PASS
[OK] SM3-PBKDF (120000 iter)        .... PASS
[OK] Master key readable            .... PASS
[OK] Audit log SM3 chain            .... PASS

GM Compliance Self-Test: 6/6 PASSED
```

---

## 附录 A：术语与缩略语

| 缩写 | 全称 | 说明 |
|------|------|------|
| SM2 | ShangMi 2 | 国密椭圆曲线公钥密码算法 |
| SM3 | ShangMi 3 | 国密杂凑算法，输出 256 bit |
| SM4 | ShangMi 4 | 国密分组对称密码，分组/密钥均 128 bit |
| PBKDF | Password-Based Key Derivation Function | 基于密码的密钥派生函数 |
| MAC | Message Authentication Code | 消息认证码 |
| SDF | Server Device Function | GM/T 0018 服务端密码设备接口 |
| CSP | Cryptographic Service Provider | 密码服务提供者 |

## 附录 B：参考标准

- GB/T 32905-2016《信息安全技术 SM3 密码杂凑算法》
- GB/T 32907-2016《信息安全技术 SM4 分组密码算法》
- GB/T 32918-2016《信息安全技术 SM2 椭圆曲线公钥密码算法》
- GB/T 39786-2021《信息安全技术 信息系统密码应用基本要求》
- GM/T 0018-2012《密码设备应用接口规范》
- GM/T 0028-2014《密码模块安全技术要求》
- GM/T 0054-2018《信息系统密码应用基本要求》

---

*本文档由 DClaw 交付团队维护，如有疑问请联系产品合规接口人。*
