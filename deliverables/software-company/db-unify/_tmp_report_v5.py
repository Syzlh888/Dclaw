import xlrd
src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)

sh = wb.sheet_by_index(3)
ncols = sh.ncols
tables = [(c, sh.cell_value(0, c)) for c in range(11, ncols, 3) if sh.cell_value(0, c)]

# 只保留三级 + 二级,中断占比 >30%,按中断率排序
rows = []
for r in range(2, sh.nrows):
    lv = sh.cell_value(r, 5)
    if lv not in ("三级", "二级"):
        continue
    valid = 0
    interrupt = 0
    for c, _ in tables:
        st = sh.cell_value(r, c + 2)
        if st == "未开展相关业务":
            continue
        valid += 1
        if st == "数据中断":
            interrupt += 1
    if valid == 0:
        continue
    pct = interrupt / valid * 100
    if pct > 30:
        rows.append({"name": sh.cell_value(r, 3), "pct": pct})

# 按中断率从高到低
rows.sort(key=lambda x: (-x["pct"], x["name"]))

# 药品(去括号,只保留医院名)
sh5 = wb.sheet_by_index(5)
from collections import defaultdict
org = defaultdict(lambda: {"停": [], "正": []})
for r in range(1, sh5.nrows):
    name = sh5.cell_value(r, 3)
    tbl = sh5.cell_value(r, 8)
    st = sh5.cell_value(r, 12)
    if st == "数据异常":
        org[name]["停"].append(tbl)
    elif st == "数据正常":
        org[name]["正"].append(tbl)

d3 = [n for n, d in org.items() if len(d["停"]) == 3]
d2 = [n for n, d in org.items() if len(d["停"]) == 2]
d1 = [n for n, d in org.items() if len(d["停"]) == 1]

lines = []
lines.append("全民健康信息平台数据日增量情况(2026-08-11 临沂市)")
lines.append("=" * 60)
lines.append("一、健康数据高铁数据中断的机构有:临沂市河东区妇幼保健院、蒙阴县中医医院、临沂市兰山区中医医院、临沂康谷温泉疗养院;")
lines.append("")
lines.append("二、电子病历数据中断占比超过30%的机构有(三级+二级,共 {} 家,按中断率排序):".format(len(rows)))
parts = ["{}({:.1f}%)".format(x["name"], x["pct"]) for x in rows]
lines.append("    " + "、".join(parts) + ";")
lines.append("")
lines.append("三、药品数据异常的机构有:")
lines.append("  3表全停({} 家):{};".format(len(d3), "、".join(d3)))
lines.append("  2表停({} 家):{};".format(len(d2), "、".join(d2)))
lines.append("  1表停({} 家):{};".format(len(d1), "、".join(d1)))
lines.append("")
lines.append("=" * 60)
lines.append("数据范围:临沂市(本批次仅1市数据)")
lines.append("电子病历中断>30% 三级+二级 合计 {} 家".format(len(rows)))
lines.append("药品异常汇总:{} 家(3表全停 {} + 2表停 {} + 1表停 {})".format(
    len(d3) + len(d2) + len(d1), len(d3), len(d2), len(d1)))

text = "\n".join(lines)
new = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\数据日增量汇报_精简版_20260811.txt"
with open(new, "w", encoding="utf-8") as f:
    f.write(text)

print(text)
print("\n---")
print("总大小:{} 字符".format(len(text)))
print("已覆盖:", new)