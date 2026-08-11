import xlrd
src = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\全民健康信息平台数据日增量情况（20260811各市）.xls"
wb = xlrd.open_workbook(src, formatting_info=False)

# 电子病历 >30%, 只保留三级+二级
sh = wb.sheet_by_index(3)
ncols = sh.ncols
tables = [(c, sh.cell_value(0, c)) for c in range(11, ncols, 3) if sh.cell_value(0, c)]
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
        rows.append({"lv": lv, "name": sh.cell_value(r, 3), "valid": valid, "interrupt": interrupt, "pct": pct})

lvl_order = {"三级": 0, "二级": 1}
rows.sort(key=lambda x: (lvl_order[x["lv"]], -x["pct"], x["name"]))

# 药品
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

d3 = [(n, d["停"]) for n, d in org.items() if len(d["停"]) == 3]
d2 = [(n, d["停"]) for n, d in org.items() if len(d["停"]) == 2]
d1 = [(n, d["停"]) for n, d in org.items() if len(d["停"]) == 1]

def short(t):
    return t.replace("药品", "").replace("表", "")

# 输出
lines = []
lines.append("全民健康信息平台数据日增量情况(2026-08-11 临沂市)")
lines.append("=" * 60)
lines.append("一、健康数据高铁数据中断的机构有:临沂市河东区妇幼保健院、蒙阴县中医医院、临沂市兰山区中医医院、临沂康谷温泉疗养院;")
lines.append("")
lines.append("二、电子病历数据中断占比超过30%的机构有(三级+二级,共 {} 家):".format(len(rows)))
g = defaultdict(list)
for x in rows:
    g[x["lv"]].append(x)
for lv in ["三级", "二级"]:
    if lv not in g:
        continue
    sub = g[lv]
    lines.append("  {}({} 家):".format(lv, len(sub)))
    parts = ["{}(中断{}/{}={:.1f}%)".format(x["name"], x["interrupt"], x["valid"], x["pct"]) for x in sub]
    lines.append("    " + "、".join(parts) + ";")
    lines.append("")

def fmt(lst, label):
    if not lst:
        return "  {}:无;".format(label)
    parts = ["{}({})".format(n, ",".join(short(x) for x in tbl)) for n, tbl in lst]
    return "  {}({} 家):{};".format(label, len(lst), "、".join(parts))


lines.append("三、药品数据异常的机构有:")
lines.append(fmt(d3, "3表全停"))
lines.append(fmt(d2, "2表停"))
lines.append(fmt(d1, "1表停"))
lines.append("")
lines.append("=" * 60)
lines.append("数据范围:临沂市(本批次仅1市数据)")
lines.append("电子病历中断>30% 三级+二级:三级 {} 家、二级 {} 家,合计 {} 家".format(
    len(g.get("三级", [])), len(g.get("二级", [])), len(rows)))
lines.append("药品异常汇总:{} 家(3表全停 {} + 2表停 {} + 1表停 {})".format(
    len(d3) + len(d2) + len(d1), len(d3), len(d2), len(d1)))

text = "\n".join(lines)
new = r"C:\Users\syzh1\Desktop\每日统计\2026-08-11\数据日增量汇报_精简版_20260811.txt"
with open(new, "w", encoding="utf-8") as f:
    f.write(text)

print(text)
print("\n---")
print("已写入:", new)
print("文件大小:", len(text), "字符")