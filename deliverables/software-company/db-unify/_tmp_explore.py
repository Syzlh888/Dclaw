import xlrd, json
src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)

# Sheet 1: 健康数据高铁概览 - 全量
sh = wb.sheet_by_index(1)
print(f"=== Sheet 1 FULL: {sh.name} rows={sh.nrows} cols={sh.ncols} ===")
rows = []
for r in range(sh.nrows):
    row = [sh.cell_value(r, c) for c in range(sh.ncols)]
    rows.append(row)

# 打印所有数据
for r in rows:
    print(r)

# 统计
from collections import Counter
status_counter = Counter()
interrupted_institutions = []  # 数据中断的机构
for r in rows[2:]:  # 跳过两行表头
    city, name, org_code, org_name, _, status, total, normal, delay, interrupt = r
    status_counter[status] += 1
    if interrupt and float(interrupt) > 0:
        interrupted_institutions.append((city, org_name, int(total), int(delay), int(interrupt)))

print("\n--- 状态统计 ---")
for k, v in status_counter.items():
    print(f"  {k}: {v}")

print(f"\n--- 数据高铁-有中断表的机构 ({len(interrupted_institutions)} 家) ---")
for it in interrupted_institutions:
    print(it)