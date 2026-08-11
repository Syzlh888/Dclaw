import xlrd
from collections import defaultdict, Counter

src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)
sh = wb.sheet_by_index(3)
nrows = sh.nrows
ncols = sh.ncols

# 表清单(31 张,从 col 11 起,每 3 列一组,状态列是 col+2)
tables = []
for c in range(11, ncols, 3):
    t = sh.cell_value(0, c)
    if t:
        tables.append((c, t))
print(f"共 {len(tables)} 张电子病历表")

# 逐机构统计: 有效表数(非"未开展相关业务")、中断表数(数据中断)、正常表数
org_stats = []  # [(机构, 表总数(去除未开展), 中断数, 中断占比%)]

for r in range(2, nrows):
    org_code = sh.cell_value(r, 2)
    org_name = sh.cell_value(r, 3)
    city = sh.cell_value(r, 1)
    level = sh.cell_value(r, 5)
    valid_total = 0   # 排除未开展后的有效表数
    interrupt_count = 0
    normal_count = 0
    delay_count = 0
    for col, tname in tables:
        status = sh.cell_value(r, col + 2)
        if status == "未开展相关业务":
            continue
        valid_total += 1
        if status == "数据中断":
            interrupt_count += 1
        elif status == "数据正常":
            normal_count += 1
        elif status == "数据延迟":
            delay_count += 1
    if valid_total == 0:
        continue
    ratio = round(interrupt_count / valid_total * 100, 1)
    org_stats.append({
        "市": city, "等级": level, "机构": org_name, "编码": org_code,
        "有效表数": valid_total, "正常": normal_count, "延迟": delay_count,
        "中断": interrupt_count, "中断占比%": ratio
    })

# 全表统计
total_orgs = len(org_stats)
total_valid = sum(x["有效表数"] for x in org_stats)
total_interrupt = sum(x["中断"] for x in org_stats)
overall_ratio = round(total_interrupt / total_valid * 100, 1)

# 全中断(100%)机构
fully_down = [x for x in org_stats if x["中断占比%"] == 100]
# 部分中断(>0 且 <100)
partial = [x for x in org_stats if 0 < x["中断占比%"] < 100]
# 0 中断
ok = [x for x in org_stats if x["中断"] == 0]

print(f"\n=== 总体(已排除'未开展相关业务')===")
print(f"机构数: {total_orgs}")
print(f"有效表总数: {total_valid}")
print(f"中断表总数: {total_interrupt}")
print(f"整体中断占比: {overall_ratio}%")
print(f"\n按机构统计:")
print(f"  完全中断(100%): {len(fully_down)} 家")
print(f"  部分中断: {len(partial)} 家")
print(f"  全部正常(0%): {len(ok)} 家")

print(f"\n=== 完全中断机构 ({len(fully_down)} 家)===")
for x in sorted(fully_down, key=lambda y: y["市"]):
    print(f"  [{x['等级']}] {x['机构']}  中断 {x['中断']}/{x['有效表数']}")

print(f"\n=== 部分中断机构 TOP20(按占比降序) ({len(partial)} 家)===")
for x in sorted(partial, key=lambda y: -y["中断占比%"])[:20]:
    print(f"  [{x['等级']}] {x['机构']}  中断 {x['中断']}/{x['有效表数']} = {x['中断占比%']}%")

print(f"\n=== 全部正常机构 ({len(ok)} 家)===")
for x in ok[:10]:
    print(f"  [{x['等级']}] {x['机构']}")
print(f"  ... 等共 {len(ok)} 家")

# 按医院等级汇总
print(f"\n=== 按医院等级汇总 ===")
by_level = defaultdict(lambda: {"机构": 0, "有效表": 0, "中断": 0})
for x in org_stats:
    by_level[x["等级"]]["机构"] += 1
    by_level[x["等级"]]["有效表"] += x["有效表数"]
    by_level[x["等级"]]["中断"] += x["中断"]
for lv, d in by_level.items():
    ratio = round(d["中断"] / d["有效表"] * 100, 1) if d["有效表"] else 0
    print(f"  {lv}: 机构 {d['机构']} 家, 有效表 {d['有效表']}, 中断 {d['中断']} ({ratio}%)")

# 保存中间结果给后续 report 写
import json
with open(r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_emr_stats.json", "w", encoding="utf-8") as f:
    json.dump({
        "total_orgs": total_orgs,
        "total_valid": total_valid,
        "total_interrupt": total_interrupt,
        "overall_ratio": overall_ratio,
        "fully_down": fully_down,
        "partial_count": len(partial),
        "ok_count": len(ok),
        "by_level": dict(by_level),
        "all_orgs": org_stats,
    }, f, ensure_ascii=False, indent=2)
print("\n-> saved _tmp_emr_stats.json")