/**
 * 数据库 JDBC 桥接 - 为 Node.js 提供 JDBC 驱动连接能力
 * 支持 SM3 国密认证等非标准 PostgreSQL 协议
 * 
 * 编译: javac HgdbBridge.java（无需驱动 JAR，仅使用 java.sql.* 标准接口）
 * 运行: java -cp ".;driver.jar" HgdbBridge --driverClass com.highgo.jdbc.Driver --urlPrefix jdbc:highgo --host ... --port ... --user ... --db ...
 *       密码通过 stdin 第一行传入（安全，避免 ps 泄漏）
 * 
 * 协议: 
 *   - 启动后输出 "READY\n" 表示连接成功
 *   - Node.js 发送 SQL（base64编码）+ 换行符到 stdin
 *   - Java 输出 JSON 结果到 stdout，以 "__END__\n" 结尾
 *   - 发送 "__EXIT__\n" 退出
 */
import java.sql.*;
import java.util.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class HgdbBridge {
    private static Connection conn;
    
    public static void main(String[] args) {
        String host = null, port = null, user = null, password = null, database = null;
        String driverClass = null, urlPrefix = null;
        
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--host": host = args[++i]; break;
                case "--port": port = args[++i]; break;
                case "--user": user = args[++i]; break;
                case "--pass": password = args[++i]; break;
                case "--db": database = args[++i]; break;
                case "--driverClass": driverClass = args[++i]; break;
                case "--urlPrefix": urlPrefix = args[++i]; break;
            }
        }
        
        if (host == null || port == null || user == null || database == null || driverClass == null) {
            System.err.println("ERROR: Missing required params (--host --port --user --db --driverClass)");
            System.exit(1);
        }

        // 如果命令行未提供 --pass，则从 stdin 第一行读取密码（更安全）
        if (password == null) {
            try {
                Scanner passwordScanner = new Scanner(System.in, "UTF-8");
                if (passwordScanner.hasNextLine()) {
                    password = passwordScanner.nextLine();
                }
            } catch (Exception e) {
                System.err.println("ERROR: Failed to read password from stdin: " + e.getMessage());
                System.exit(1);
            }
        }
        
        // 默认使用 PostgreSQL URL 前缀
        if (urlPrefix == null || urlPrefix.isEmpty()) {
            urlPrefix = "jdbc:postgresql";
        }
        
        try {
            Class.forName(driverClass);
            // 设置 JDBC 登录超时（15秒），防止连接无响应时无限挂起
            DriverManager.setLoginTimeout(15);
            // URL 编码数据库名，防止特殊字符破坏 JDBC URL
            String encodedDb = URLEncoder.encode(database, StandardCharsets.UTF_8.toString());
            String url = urlPrefix + "://" + host + ":" + port + "/" + encodedDb;
            conn = DriverManager.getConnection(url, user, password != null ? password : "");
            DriverManager.setLoginTimeout(0); // 恢复默认
            
            System.out.println("READY");
            System.out.flush();
            
            Scanner scanner = new Scanner(System.in, "UTF-8");
            while (scanner.hasNextLine()) {
                String line = scanner.nextLine().trim();
                
                if (line.isEmpty()) continue;
                if ("__EXIT__".equals(line)) break;
                if ("__PING__".equals(line)) {
                    System.out.println("PONG");
                    System.out.println("__END__");
                    System.out.flush();
                    continue;
                }
                
                // 解码 base64 SQL
                String sql;
                try {
                    sql = new String(Base64.getDecoder().decode(line), "UTF-8");
                } catch (Exception e) {
                    System.out.println(errorJson("无效的 Base64 SQL: " + e.getMessage()));
                    System.out.println("__END__");
                    System.out.flush();
                    continue;
                }
                
                try {
                    Statement stmt = conn.createStatement();
                    // 设置查询超时（20秒），防止 SQL 执行无限挂起
                    stmt.setQueryTimeout(20);
                    boolean isResultSet = stmt.execute(sql);
                    
                    if (isResultSet) {
                        ResultSet rs = stmt.getResultSet();
                        ResultSetMetaData meta = rs.getMetaData();
                        int colCount = meta.getColumnCount();
                        
                        StringBuilder json = new StringBuilder();
                        json.append("{\"columns\":[");
                        for (int i = 1; i <= colCount; i++) {
                            if (i > 1) json.append(",");
                            json.append("\"").append(escapeJson(meta.getColumnName(i))).append("\"");
                        }
                        json.append("],\"rows\":[");
                        
                        boolean firstRow = true;
                        while (rs.next()) {
                            if (!firstRow) json.append(",");
                            firstRow = false;
                            json.append("{");
                            for (int i = 1; i <= colCount; i++) {
                                if (i > 1) json.append(",");
                                json.append("\"").append(escapeJson(meta.getColumnName(i))).append("\":");
                                Object val = rs.getObject(i);
                                json.append(valueToJson(val));
                            }
                            json.append("}");
                        }
                        json.append("]}");
                        
                        System.out.println(json.toString());
                    } else {
                        int count = stmt.getUpdateCount();
                        System.out.println("{\"columns\":[\"affected_rows\"],\"rows\":[{\"affected_rows\":" + count + "}]}");
                    }
                    stmt.close();
                } catch (SQLException e) {
                    System.out.println(errorJson(e.getMessage()));
                }
                
                System.out.println("__END__");
                System.out.flush();
            }
            
            scanner.close();
            conn.close();
        } catch (Exception e) {
            System.err.println("FATAL: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }
    }
    
    private static String errorJson(String msg) {
        return "{\"error\":\"" + escapeJson(msg) + "\"}";
    }
    
    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
    
    private static String valueToJson(Object val) {
        if (val == null) return "null";
        if (val instanceof Number) {
            String s = val.toString();
            if (s.equals("NaN") || s.equals("Infinity") || s.equals("-Infinity")) {
                return "\"" + s + "\"";
            }
            return s;
        }
        if (val instanceof Boolean) {
            return val.toString();
        }
        return "\"" + escapeJson(val.toString()) + "\"";
    }
}
