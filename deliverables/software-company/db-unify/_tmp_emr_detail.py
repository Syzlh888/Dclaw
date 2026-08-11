import xlrd, json
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

# 加载已统计的中间结果
with open(r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_emr_stats.json", encoding="utf-8") as f:
    prev = json.load(f)

# 重新做精确计数,这次同时输出 上传数量(正常+延迟) 和 中断数量
rows = []
for r in range(2, nrows):
    org_code = sh.cell_value(r, 2)
    org_name = sh.cell_value(r, 3)
    city = sh.cell_value(r, 1)
    level = sh.cell_value(r, 5)
    econ = sh.cell_value(r, 6)
    valid_total = 0
    normal_count = 0
    delay_count = 0
    interrupt_count = 0
    not_open_count = 0
    for col, tname in tables:
        status = sh.cell_value(r, col + 2)
        if status == "未开展相关业务":
            not_open_count += 1
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
    rows.append({
        "市": city, "等级": level, "机构": org_name, "编码": org_code,
        "有效表数": valid_total,
        "上传_正常": normal_count,
        "上传_延迟": delay_count,
        "上传_合计": normal_count + delay_count,
        "中断": interrupt_count,
        "未开展": not_open_count,
        "中断占比%": round(interrupt_count / valid_total * 100, 1)
    })

print(f"共 {len(rows)} 家机构(已剔除全未开展)")

# 排序: 中断数降序, 中断相同时按上传量降序
rows_sorted = sorted(rows, key=lambda x: (-x["中断"], -x["上传_合计"], x["机构"]))

# 输出完整明细到 txt
out_path = r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_emr_detail.txt"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"=== 电子病历明细(已排除'未开展相关业务') ===\n")
    f.write(f"机构数: {len(rows)}  有效表: {sum(r['有效表数'] for r in rows)}  中断表: {sum(r['中断'] for r in rows)}\n")
    f.write(f"列: 等级 | 机构 | 上传(正常+延迟) | 中断 | 有效 | 中断占比\n\n")

    # 分组:三级/二级/一级/基层
    for level in ["三级", "二级", "一级", "基层"]:
        sub = [r for r in rows_sorted if r["等级"] == level]
        if not sub: continue
        f.write(f"\n### {level}({len(sub)} 家)\n")
        for i, r in enumerate(sub, 1):
            f.write(f"{i:>3}. {r['机构']:<32} 上传 {r['上传_合计']:>3}({r['上传_正常']}正+{r['上传_延迟']}延) | 中断 {r['中断']:>3} | 有效 {r['有效表数']:>3} | {r['中断占比%']}%\n")

# 同时输出 json 供后续报告拼接
with open(r"D:\Work Space\DClaw\deliverables\software-company\db-unify\_tmp_emr_detail.json", "w", encoding="utf-8") as f:
    json.dump(rows_sorted, f, ensure_ascii=False, indent=2)

print(f"\n明细已写入 {out_path}")
print(f"\n=== 前 30 行预览(按中断数降序) ===")
for i, r in enumerate(rows_sorted[:30], 1):
    print(f"{i:>3}. [{r['等级']}] {r['机构']:<30}  上传{r['上传_合计']}({r['上传_正常']}+{r['上传_延迟']})  中断{r['中断']}  {r['中断占比%']}%")