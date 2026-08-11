import xlrd
src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)

# === 电子病历 >30% ===
sh = wb.sheet_by_index(3)
ncols = sh.ncols
tables = [(c, sh.cell_value(0, c)) for c in range(11, ncols, 3) if sh.cell_value(0, c)]
above30 = []
for r in range(2, sh.nrows):
    valid = 0; interrupt = 0
    for c, _ in tables:
        st = sh.cell_value(r, c + 2)
        if st == "未开展相关业务": continue
        valid += 1
        if st == "数据中断": interrupt += 1
    if valid == 0: continue
    pct = interrupt / valid * 100
    if pct > 30:
        above30.append({
            "name": sh.cell_value(r, 3),
            "level": sh.cell_value(r, 5),
            "valid": valid, "interrupt": interrupt, "pct": pct
        })

lvl_order = {"三级": 0, "二级": 1, "一级": 2, "基层": 3}
above30.sort(key=lambda x: (lvl_order.get(x["level"], 9), -x["pct"], x["name"]))

# === 药品异常分类 ===
sh5 = wb.sheet_by_index(5)
from collections import defaultdict
org = defaultdict(lambda: {"停表": [], "正常表": []})
for r in range(1, sh5.nrows):
    name = sh5.cell_value(r, 3)
    tbl = sh5.cell_value(r, 8)
    st = sh5.cell_value(r, 12)
    if st == "数据异常": org[name]["停表"].append(tbl)
    elif st == "数据正常": org[name]["正常表"].append(tbl)
drug3 = [(n, d["停表"]) for n, d in org.items() if len(d["停表"]) == 3]
drug2 = [(n, d["停表"]) for n, d in org.items() if len(d["停表"]) == 2]
drug1 = [(n, d["停表"]) for n, d in org.items() if len(d["停表"]) == 1]

# 表名简化: 药品清单目录 / 药品入库明细 / 药品销售明细
def short_tbl(t):
    return t.replace("药品", "").replace("表", "")

# 拼接
lines = []
lines.append("全民健康信息平台数据日增量情况(2026-08-11 临沂市)")
lines.append("=" * 60)
lines.append("一、健康数据高铁数据中断的机构有:临沂市河东区妇幼保健院、蒙阴县中医医院、临沂市兰山区中医医院、临沂康谷温泉疗养院;")
lines.append("")

# 电子病历
lines.append("二、电子病历数据中断占比超过30%的机构有(共 {} 家):".format(len(above30)))
groups = defaultdict(list)
for x in above30:
    groups[x["level"]].append(x)
for lv in ["三级", "二级", "一级", "基层"]:
    if lv not in groups: continue
    sub = groups[lv]
    lines.append("  %s(%d 家):" % (lv, len(sub)))
    parts = ["%s(中断%d/%d=%.1f%%)" % (x["name"], x["interrupt"], x["valid"], x["pct"]) for x in sub]
    lines.append("    " + "、".join(parts) + ";")
    lines.append("")

# 药品
def fmt_drug_group(lst, label):
    if not lst: return "  %s:无;" % label
    parts = []
    for n, t in lst:
        tt = ",".join(short_tbl(x) for x in t)
        parts.append("%s(%s)" % (n, tt))
    return "  %s(%d 家):%s;" % (label, len(lst), "、".join(parts))

lines.append("三、药品数据异常的机构有:")
lines.append(fmt_drug_group(drug3, "3表全停"))
lines.append(fmt_drug_group(drug2, "2表停"))
lines.append(fmt_drug_group(drug1, "1表停"))
lines.append("")

lines.append("=" * 60)
lines.append("数据范围:临沂市(本批次仅1市数据)")
lines.append("电子病历中断>30% 汇总:三级 {} 家、二级 {} 家、一级 {} 家、基层 {} 家,合计 {} 家".format(
    len(groups.get("三级", [])), len(groups.get("二级", [])),
    len(groups.get("一级", [])), len(groups.get("基层", [])), len(above30)
))
lines.append("药品异常汇总:{} 家(3表全停 {} + 2表停 {} + 1表停 {})".format(
    len(drug3)+len(drug2)+len(drug1), len(drug3), len(drug2), len(drug1)
))

text = "\n".join(lines)
out_path = r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_report_v2.txt"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)

# 另存到桌面,新文件名,不删除原文件
import shutil
new_path = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\数据日增量汇报_精简版_20260811.txt"
shutil.copy(out_path, new_path)

print("=== 已生成(共 %d 字符)===" % len(text))
print("\n文件路径:")
print("  新版: " + new_path)
print("  原文件保留: 数据日增量汇报_20260811.txt + 电子病历明细_20260811.txt")

print("\n=== 内容预览(前 1500 字) ===")
print(text[:1500])