#!/usr/bin/env python3
"""
MiniMax 海螺视频 T2V (Text-to-Video) — 敦煌飞天
==============================================
调用 MiniMax Hailuo API 生成文生视频。

流程:
  Step 1: POST /v1/video_generation  → 创建任务，获取 task_id
  Step 2: GET  /v1/query/video_generation?task_id=xxx → 轮询状态，最多 5 分钟
  Step 3: GET  /v1/files/retrieve?file_id=xxx → 获取 download_url 并下载

依赖: 仅使用 Python 标准库 (urllib, json, os, time, sys)
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

# ── 配置 ──────────────────────────────────────────────────
API_BASE = "https://api.minimaxi.com/v1"
MODEL = "MiniMax-Hailuo-2.3"
DURATION = 6
RESOLUTION = "1080P"
PROMPT_OPTIMIZER = False         # 关掉AI优化，保留我们自己写的精细描述

POLL_INTERVAL = 10       # 轮询间隔 (秒)
MAX_WAIT = 300           # 最大等待时间 (秒 / 5 分钟)

PROMPT = (
    "巅峰画质，超高清8K画质，动漫唯美风格，二次元精致画风，顶级插画级细节，"
    ""
    "【面部】精致动漫少女面容，鹅蛋脸下巴尖巧，肌肤白皙胜雪泛珍珠光泽透樱花粉腮红，"
    "杏眼大而明亮眼角上挑带丹凤眼韵味，双眼皮深邃上睫毛浓密纤长微翘，瞳仁琥珀金棕瞳孔深处有星辰闪烁，"
    "柳叶眉纤细秀美，鼻梁高挺鼻头小巧，唇如樱桃花瓣上唇M形完美下唇丰润含笑露出贝齿，"
    "眉心朱红吉祥痣，耳戴金色莲花托玛瑙坠耳环"
    ""
    "【发饰与发型】"
    "一头乌黑如墨的青丝长发及腰，发质柔顺丝滑泛着蓝紫色的光泽，发量浓密丰厚，发丝根根分明在风中飘动如瀑布般倾泻而下，"
    "头顶梳着华丽的高髻样式为唐代双环望仙髻，两个发髻圆润饱满分成左右对称，"
    "发髻上插满了金碧辉煌的发饰——正中是一朵硕大的金色牡丹花簪花瓣层层叠叠共九层，左右各插三支凤尾金步摇，"
    "凤凰的眼睛是翡翠绿宝石，凤尾由极细的金丝扭成含三根垂珠流苏随着动作轻轻摇曳，"
    "发髻后方还插着碧玉七孔簪和白玉梳背，碎发刘海在额前轻柔飘动更添了几分灵动，"
    ""
    "【服饰细节】"
    "身穿七重华美的霓裳羽衣，最外层的广袖大衫是半透明的烟霞色绡纱轻薄如蝉翼隐约可见内层衣饰，"
    "纱面上用金线绣满了精致的缠枝莲纹和展翅的飞天神鸟图案，第二层是朱红色的织锦长裙上绣着金凤穿花纹，"
    "第三层是淡青色的薄绸在阳光下泛着贝母般的光泽，第四层是月白色的素绢内裙质地柔软贴身，"
    "长裙从胸部以下自然垂落形成优美的水波纹褶皱，裙摆宽大拖曳开来铺展在祥云上如盛开的花朵，"
    "裙摆边缘镶着一圈金线绣成的卷草纹，腰带上束着一条金丝编织的软带缀着九颗猫眼石与翡翠交替排列，"
    "腰带在身前打成一个蝴蝶结垂下长长的两股流苏由金色丝线和米粒大小的珍珠串成约有半米长，"
    "胸前佩戴着一套三层宝珠璎珞——第一层是十八颗莲子大小的东珠串成，第二层是镂空金片作底镶着红蓝绿三色宝石，"
    "最下层垂着一块羊脂白玉佩雕刻成莲花形状，腰间还挂着一对金香球和一枚双鱼玉佩，"
    "两条手臂上各戴着三只雕花金臂钏雕刻着精美的唐草纹和飞马图案，手腕上戴着一对通透的翡翠手镯翠色欲滴，"
    "十根手指纤细修长如削葱根，指甲涂着淡粉色的蔻丹每根指甲上用金粉画着细小的梅花纹样，"
    ""
    "【琵琶乐器】"
    "手中的琵琶是顶级工匠打造的宝物，通体用上等紫檀木制成木纹清晰美丽呈饱满的半梨形线条圆润流畅，"
    "琴面上镶嵌着精美的螺钿花纹——用夜光贝、鲍鱼贝、青贝镶嵌成一只展翅的蝴蝶和缠枝莲花，"
    "琴头雕刻成凤凰回首的造型凤凰的眼睛镶嵌着两粒小米大的红宝石，琴颈上绑着红色丝绦系着一个小巧的翡翠坠子，"
    "四个琴轴用白玉制成雕刻成如意头形状，琴弦是上好丝弦泛着银白色的光泽，"
    ""
    "【动作姿态】"
    "飞天仙女身体呈现出标准的S形三道弯体态，上半身微微向后倾斜约30度胸部挺起展现出优美的身体曲线，"
    "腰肢纤细柔软如风中柳枝仿佛不盈一握，左足轻盈地点在一朵翻涌的彩色祥云上五趾微微分开，"
    "右腿自膝盖以下向后高高抬起小腿与大腿呈直角脚尖绷直脚背上挂着一串金色小铃铛，"
    "双手以极为优美的手势反弹琵琶——左手从琵琶上方越过用大拇指和食指按住琴颈中段的琴弦其余三根手指优雅地微微翘起呈兰花指状，"
    "右手伸到琵琶面板下方从底部向上拨动琴弦五根手指飞速舞动仿佛能看到琴弦在震动，"
    "头部微微侧向肩膀眼神低垂注视着手中的琵琶，嘴角含着一抹沉浸于音乐中的温柔微笑，"
    ""
    "【飘带】"
    "身上缠绕着十二条色彩各异的轻盈天衣飘带每一条宽窄不同从最宽的三寸到最细的如丝线般，"
    "颜色依次为正红色、橙色、金黄色、翠绿色、碧蓝色、宝蓝色、丁香紫、玫粉色、月白色、烟灰色、浅藕荷色、珊瑚粉，"
    "每条飘带都用极轻薄的丝绸制成半透明泛着丝光，飘带的边缘镶着极细的金线银线闪闪发光，"
    "飘带面上绣着细细的银线云纹和金色莲花图案，十二条飘带在仙女身体周围形成复杂的交织盘旋轨迹——"
    "有的从肩后垂落到腰际再向上翻卷，有的从手臂间穿过环绕腰身再飘向远方，有的从脚踝处旋转上升层层叠叠，"
    "飘带在夕阳照射下半透明的质地透出温暖的光晕，每条飘带在空气中划过都会留下一道细细的流光尾迹，"
    ""
    "【脚下祥云】"
    "脚下踩着层层叠叠的五彩祥云，云朵由近及远铺展开来约有十平方米的范围质地蓬松柔软如棉絮，"
    "云层从下到上有五种颜色渐变——底部的深紫色逐渐过渡到上层的玫瑰红再从粉红色过渡到金色最后到月白色，"
    "云层的表面翻涌滚动如沸腾的水面不断变幻形状，云层中有细小的金色光点闪烁仿佛星尘，"
    ""
    "【背景场景——天空】"
    "时间是傍晚日落时分整片天空呈现出壮丽无比的晚霞，从画面最高处的深靛蓝色逐渐向下过渡——"
    "深紫罗兰色到薰衣草紫到玫瑰红到珊瑚橙到金橙色到淡黄色到地平线附近的暖白色，"
    "天空中有七道金色佛光从云层缝隙中射向大地形成放射状的光柱效果，光柱中可见细小的尘埃粒子在飞舞闪烁，"
    "画面左上角有一轮淡淡的月亮轮廓，西边的天空飘着几片火烧云形状各异有的像飞龙有的像莲花，云朵的边缘被落日镀上了一层璀璨的金边，"
    ""
    "【背景场景——莫高窟】"
    "画面左侧是宏伟壮观莫高窟九层楼建筑群楼阁依山而建层层叠叠向上延伸，"
    "最前方的楼阁飞檐翘角每层的屋脊上都蹲坐着琉璃鸱吻，朱红色的立柱和窗棂清晰可见柱子上的彩绘油漆斑驳但依旧华丽，"
    "每一层的窗户里透出温暖的橘黄色烛光，楼阁墙壁上隐约可见残存的壁画痕迹——供养人像、莲花藻井图案、千佛壁画的斑驳色彩，"
    "楼阁前的地面上有几名穿着红色袈裟的僧人正在点灯的微小身影，楼阁周围长着几棵挺拔的胡杨树树叶已经变成了金黄色，"
    ""
    "【背景场景——沙漠】"
    "画面右侧延伸开来的是无边无际的鸣沙山，沙丘连绵起伏如凝固的金色波浪，"
    "沙丘的迎光面是明亮的金黄色而背光面是深邃的暖棕色形成了强烈的明暗对比，"
    "每座沙丘的棱线在夕阳低角度照射下呈现出完美的曲线和锋利的边缘，沙面上一层层的风纹清晰可见如水的涟漪，"
    "极远处的沙丘和天际线融为一体如海市蜃楼，沙丘表面偶有几株骆驼刺和芨芨草的小小绿色点缀，"
    ""
    "【光影与氛围光效】"
    "整个画面沐浴在夕阳的金色暖光中，光源位于画面右下方地平线附近，仙女的左侧身体被夕阳照得通透明亮衣物的边缘泛着金色的光晕，"
    "右侧身体处于柔和的阴影中形成了自然的明暗立体感，仙女的头发上反射出细碎的金色光点，"
    "飘带的半透明质地透出背后的夕阳形成透光效果，"
    "背景中有柔和的光晕效果仿佛佛光普照，空气中漂浮着无数细小的发光尘埃和金色光点如同精灵般四处飘散，"
    "三五只白色的仙鹤从远处飞过在夕阳中化作剪影，"
    ""
    "【画面整体氛围】"
    "整幅画面充满了梦幻般的意境如同一幅会动的敦煌飞天壁画，色彩瑰丽绚烂但又不失雅致，"
    "光与影交织创造出神圣而空灵的氛围，每一条飘带的每一次波动都充满了音乐的节奏感，"
    "仿佛能透过画面听到悠扬的古琵琶声和远处洞窟传出的梵唱声，风声吹动衣袂发出簌簌的轻响，"
    "大漠的空旷和洞窟的深邃形成广阔与神秘的对比，"
    ""
    "【镜头运动与电影语言】"
    "[左摇][推进]镜头从画面右侧的沙漠角度开始先展示整个大漠落日的全景视角，"
    "然后镜头保持高度从左向右缓慢横移每秒移动一个身位的速度，"
    "当飞天进入画面中心位置后镜头开始缓慢推进从中景推向近景，"
    "焦距变化产生自然的景深效果使背景微微虚化但依然可辨认，"
    "镜头最终停在仙女的面部半身特写位置停留两秒让观众看清表情细节，"
    "整体运镜节奏舒缓带有慢动作效果仿佛时间被拉长，"
    "整个6秒钟的画面如同一首流动的诗歌每一帧都能截下来当作精美的壁纸，"
    "极致细节每一根发丝和飘带的纹理都清晰可见"
)


# ── 工具函数 ──────────────────────────────────────────────

def load_api_key(script_dir: str) -> str:
    """
    加载 API Key。
    优先级: 环境变量 MINIMAXI_API_KEY > 脚本同目录 .env 文件
    """
    # 1) 环境变量
    key = os.environ.get("MINIMAXI_API_KEY")
    if key:
        return key

    # 2) .env 文件
    env_path = os.path.join(script_dir, ".env")
    if not os.path.isfile(env_path):
        raise RuntimeError(
            f"MINIMAXI_API_KEY 未设置。请在环境变量中设置，或在 {env_path} 中添加:\n"
            f"  MINIMAXI_API_KEY=your_api_key_here"
        )

    with open(env_path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            # 跳过空行和注释
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "MINIMAXI_API_KEY":
                return v

    raise RuntimeError("在 .env 文件中未找到 MINIMAXI_API_KEY")


def http_request(
    method: str,
    path: str,
    headers: dict | None = None,
    body: dict | None = None,
    timeout: int = 60,
) -> tuple[int, dict]:
    """
    通用 HTTP 请求 (urllib)。
    返回 (status_code, parsed_json_response)
    """
    url = f"{API_BASE}{path}"
    req_headers = headers.copy() if headers else {}
    data = json.dumps(body).encode("utf-8") if body else None

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw_body = e.read().decode("utf-8") if e.fp else "{}"
        try:
            parsed = json.loads(raw_body)
        except json.JSONDecodeError:
            parsed = {"error": raw_body}
        return e.code, parsed


def fmt_duration(seconds: float) -> str:
    """格式化耗时为 m:ss 或 xx.xs"""
    if seconds < 60:
        return f"{seconds:.0f}s"
    m, s = divmod(int(seconds), 60)
    return f"{m}m{s:02d}s"


# ── 三步流程 ──────────────────────────────────────────────

def step1_create_task(api_key: str) -> str:
    """Step 1: 创建视频生成任务 → 返回 task_id"""
    print("=" * 60)
    print("  Step 1: 创建视频生成任务")
    print("=" * 60)
    print(f"  模型:    {MODEL}")
    print(f"  时长:    {DURATION}s")
    print(f"  分辨率:  {RESOLUTION}")
    print(f"  优化提示词: {PROMPT_OPTIMIZER}")
    print()

    status, result = http_request(
        "POST",
        "/video_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        body={
            "model": MODEL,
            "prompt": PROMPT,
            "duration": DURATION,
            "resolution": RESOLUTION,
            "prompt_optimizer": PROMPT_OPTIMIZER,
        },
        timeout=60,
    )

    # 尝试多种错误字段
    err_msg = (
        result.get("base_resp", {}).get("status_msg")
        or result.get("error", {}).get("message")
        or result.get("message")
        or str(result)
    )

    if status != 200:
        raise RuntimeError(f"创建任务失败 (HTTP {status}): {err_msg}")

    # 检查业务错误码
    base_resp = result.get("base_resp", {})
    base_code = base_resp.get("status_code", 0)
    if base_code != 0:
        raise RuntimeError(f"创建任务失败 (code {base_code}): {base_resp.get('status_msg', err_msg)}")

    task_id = result.get("task_id")
    if not task_id:
        raise RuntimeError(f"响应中未找到 task_id，完整响应:\n{json.dumps(result, indent=2, ensure_ascii=False)}")

    print(f"  ✅ 任务已创建")
    print(f"     task_id: {task_id}")
    return task_id


def step2_poll_status(api_key: str, task_id: str) -> str:
    """Step 2: 轮询任务状态 → 返回 file_id"""
    print()
    print("=" * 60)
    print("  Step 2: 轮询任务状态")
    print("=" * 60)

    last_status = None
    start = time.time()

    while True:
        elapsed = time.time() - start

        if elapsed > MAX_WAIT:
            raise RuntimeError(
                f"任务超时: 等待 {fmt_duration(MAX_WAIT)} 后任务仍未完成\n"
                f"    最后状态: {last_status}\n"
                f"    请稍后使用 task_id 手动查询: {task_id}"
            )

        status_code, result = http_request(
            "GET",
            f"/query/video_generation?task_id={task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )

        if status_code != 200:
            print(f"  ⚠️ HTTP {status_code} 查询异常，{POLL_INTERVAL}s 后重试...")
            time.sleep(POLL_INTERVAL)
            continue

        current = result.get("status", "Unknown")

        # 仅状态变化时打印
        if current != last_status:
            print(f"  [{fmt_duration(elapsed)}] → {current}")
            last_status = current

        # 成功
        if current == "Success":
            file_id = result.get("file_id")
            if not file_id:
                raise RuntimeError(
                    f"任务成功但未返回 file_id:\n{json.dumps(result, indent=2, ensure_ascii=False)}"
                )
            print(f"  ✅ 任务完成")
            print(f"     file_id: {file_id}")
            return file_id

        # 失败
        if current in ("Fail", "Failed"):
            err = (
                result.get("base_resp", {}).get("status_msg")
                or result.get("error", {}).get("message")
                or json.dumps(result, ensure_ascii=False)
            )
            raise RuntimeError(f"任务失败: {err}")

        time.sleep(POLL_INTERVAL)


def step3_download(api_key: str, file_id: str, output_dir: str) -> str:
    """Step 3: 获取下载链接并下载视频 → 返回保存路径"""
    print()
    print("=" * 60)
    print("  Step 3: 获取下载链接并下载视频")
    print("=" * 60)

    # ── 3a: 获取 download_url ──
    print(f"  获取文件信息 (file_id={file_id})...")

    status, result = http_request(
        "GET",
        f"/files/retrieve?file_id={file_id}",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )

    err_msg = (
        result.get("base_resp", {}).get("status_msg")
        or result.get("error", {}).get("message")
        or str(result)
    )
    if status != 200:
        raise RuntimeError(f"获取文件信息失败 (HTTP {status}): {err_msg}")

    # 尝试多种字段名
    file_obj = result.get("file", {})
    download_url = file_obj.get("download_url") or result.get("download_url")

    if not download_url:
        raise RuntimeError(
            f"未找到 download_url，完整响应:\n{json.dumps(result, indent=2, ensure_ascii=False)}"
        )

    print(f"  ✅ 下载链接获取成功")

    # ── 3b: 下载视频 ──
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(output_dir, f"dunhuang_feitian_{timestamp}.mp4")

    print(f"  下载中...")
    print(f"  目标: {output_path}")

    req = urllib.request.Request(download_url)
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            total = resp.headers.get("Content-Length")
            if total:
                print(f"  文件大小: {int(total) / 1024 / 1024:.2f} MB")

            downloaded = 0
            last_report = 0
            with open(output_path, "wb") as f:
                while True:
                    chunk = resp.read(65536)  # 64 KB
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    # 每 5 MB 打印一次进度
                    if downloaded - last_report >= 5 * 1024 * 1024:
                        print(f"    已下载 {downloaded / 1024 / 1024:.1f} MB ...")
                        last_report = downloaded
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"下载失败 (HTTP {e.code}): {e.reason}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"下载失败 (网络错误): {e.reason}")

    file_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"  ✅ 下载完成 ({file_mb:.2f} MB)")
    return output_path


# ── 入口 ──────────────────────────────────────────────────

def main():
    print()
    print("🎨" * 18)
    print("    MiniMax 海螺视频 T2V — 敦煌飞天")
    print("🎨" * 18)
    print()

    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(script_dir, "outputs")

        # ── 加载 API Key ──
        print("🔑 加载 API Key ...")
        api_key = load_api_key(script_dir)
        print(f"   ✅ API Key 已加载 ({'环境变量' if os.environ.get('MINIMAXI_API_KEY') else '.env 文件'})")
        print()

        # ── Step 1 → 2 → 3 ──
        task_id = step1_create_task(api_key)
        file_id = step2_poll_status(api_key, task_id)
        final_path = step3_download(api_key, file_id, output_dir)

        # ── 收尾 ──
        print()
        print("=" * 60)
        print("  🎉 全部完成！")
        print(f"  ✅ 视频已保存到 {final_path}")
        print("=" * 60)
        print()

    except KeyboardInterrupt:
        print("\n⚠️  用户中断")
        sys.exit(130)
    except RuntimeError as e:
        print(f"\n❌ 错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 未预期的错误: {type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
