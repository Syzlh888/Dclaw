import xlrd
from collections import defaultdict, Counter
src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)
sh = wb.sheet_by_index(5)
nrows = sh.nrows

# 列: 0 市,1 市名,2 机构编码,3 机构名,4 省属,5 类型,6 等级,
# 7 表英文名,8 表中文名,9 累计量,10 最近上报时间,11 状态代码,12 状态名称

# 按机构聚合: (状态代码 → 各表计数)
org_agg = defaultdict(lambda: {"正常": [], "异常": [], "未对接": [], "其他": []})

# 枚举所有状态
status_counter = Counter()
for r in range(1, nrows):
    code = sh.cell_value(r, 2)
    name = sh.cell_value(r, 3)
    table = sh.cell_value(r, 8)
    last_time = sh.cell_value(r, 10)
    status_code = sh.cell_value(r, 11)
    status_name = sh.cell_value(r, 12)
    status_counter[status_name] += 1

    if status_name == "数据正常":
        org_agg[(code, name)]["正常"].append((table, last_time))
    elif status_name == "数据异常":
        org_agg[(code, name)]["异常"].append((table, last_time))
    elif status_name == "未对接":
        org_agg[(code, name)]["未对接"].append(table)
    else:
        org_agg[(code, name)]["其他"].append((table, status_name))

print("=== 状态分布 ===")
for k, v in status_counter.items():
    print(f"  {k}: {v}")

print(f"\n=== 机构总数 === {len(org_agg)}")

# 异常的机构
abnormal = []
for (code, name), d in org_agg.items():
    if d["异常"]:
        abnormal.append({"code": code, "name": name, "abnormal_tables": d["异常"], "normal_tables": d["正常"]})

print(f"\n=== 数据异常的机构({len(abnormal)} 家)===")
for a in abnormal:
    print(f"\n[{a['code']}] {a['name']}")
    for tbl, t in a['abnormal_tables']:
        print(f"  异常: {tbl}  最近上报: {t}")
    if a['normal_tables']:
        print(f"  (其他表正常: {[x[0] for x in a['normal_tables']]})")

# 保存
import json
with open(r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_drug_stats.json", "w", encoding="utf-8") as f:
    json.dump({
        "status_counter": dict(status_counter),
        "total_orgs": len(org_agg),
        "abnormal_count": len(abnormal),
        "abnormal": abnormal,
    }, f, ensure_ascii=False, indent=2)