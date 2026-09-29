# -*- coding: utf-8 -*-
"""生成 ID Plan 演示备份 JSON（可导入）。5 个并行项目，各处于不同阶段/看板列。
结构严格遵循 backup.service.ts 的 zod schema（schemaVersion=3，0.8.3 起）。

关键设计（修正 v1 的"都在深化中"问题）：
  看板列判定（HomePage.groupByColumn）看的是「今天 2026-08-29 落在哪个阶段的日期区间」
  返回的 orderIndex（currentStageOf），而不是 status 字段本身。
  故本脚本以 today=2026-08-29 为锚点，为每个项目精确设定各段 startAt/endAt，
  使当前阶段号精确落到目标看板列：
    - 待启动 todo   ：项目未开始（plannedStartAt > today）
    - 设计中 design ：当前阶段 ①提案 / ②测量 / ③平面方案（方案前测）
    - 深化中 deepen ：当前阶段 ④SU 建模 / ⑤效果图
    - 施工中 build  ：当前阶段 ⑦材料表 / ⑧交付 / ⑨实景，或全部完成
  员工命名参照 aespa（Karina/Giselle/Winter/Ningning）+ BLACKPINK（Jisoo/Jennie/Rosé/Lisa），
  每人指派真实工作任务。
"""
import json, datetime

# ★ 2026-09-30 0.8.3：日期锚改为**动态今天**（原写死 2026-08-29，阶段区间
#   随真实时间过期 → 看板列判定漂移，示例项目失去示范意义）。生成时刻的
#   时间戳同步动态化，保证「任何时候生成，导入后列分布都正确」。
NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
TODAY = datetime.date.today().isoformat()

def iso(d: str) -> str:
    return d + "T00:00:00.000Z"

def d(offset_days: int) -> str:
    """相对今天偏移的天数（today=2026-08-29）"""
    base = datetime.date.fromisoformat(TODAY)
    return (base + datetime.timedelta(days=offset_days)).isoformat()

# ---------------- 成员（aespa + BLACKPINK / 中文名，每人一个设计岗） ----------------
# admin 为「设计师本人」（0.8.3 脱敏：开源产物不带真实姓名）；8 位成员负责不同专业
members = [
    # ★ 2026-09-30 脱敏：开源产物不带真实姓名/邮箱（demo 自足即可）
    {"id":"mem_admin","name":"设计师本人","role":"主案设计师","contact":"designer@demo.local",
     "avatarColor":"#5B8C5A","active":True,"roleKind":"admin","revision":1,"updatedAt":NOW},
    {"id":"mem_karina","name":"刘知珉","role":"方案设计师","contact":"karina@demo.cn",
     "avatarColor":"#B25C5C","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_giselle","name":"金慧玲","role":"深化设计师","contact":"giselle@demo.cn",
     "avatarColor":"#5C7A9E","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_winter","name":"金敏珍","role":"效果图渲染","contact":"winter@demo.cn",
     "avatarColor":"#C98D5B","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_ningning","name":"朴宁宁","role":"软装陈设","contact":"ningning@demo.cn",
     "avatarColor":"#7A6C9E","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_jisoo","name":"金智秀","role":"材料选型","contact":"jisoo@demo.cn",
     "avatarColor":"#5B8C5A","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_jennie","name":"金珍妮","role":"项目助理","contact":"jennie@demo.cn",
     "avatarColor":"#B8905C","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_rose","name":"朴彩英","role":"现场驻场","contact":"rose@demo.cn",
     "avatarColor":"#8A959E","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
    {"id":"mem_lisa","name":"拉丽萨","role":"拍摄策划","contact":"lisa@demo.cn",
     "avatarColor":"#6C8AA8","active":True,"roleKind":"member","revision":1,"updatedAt":NOW},
]

projects, stages, tasks, logs, assignments, contracts = [], [], [], [], [], []

# 室内全流程九段（模板 key/名称/占比/色号）, 与 stage-library.json indoor_full 一致
INDOOR9 = [
    ("indoor.proposal","提案",5,1),("indoor.measure","测量",4,2),
    ("indoor.concept_plan","平面方案",11,3),("indoor.su_model","SU 建模",10,4),
    ("indoor.rendering","效果图",14,5),("indoor.construction_drawing","施工图深化",22,6),
    ("indoor.material_list","材料表",10,7),("indoor.handover","交付",19,8),
    ("indoor.photography","实景",5,9),
]

# 每个阶段的可指派任务池（含方案前测相关内容）
TASK_POOL = {
    1: ["需求沟通与现场踏勘预约","概念意向与风格提案","概算与报价","签订合同","方案前测·风格意向问卷"],
    2: ["现场尺寸复测核对","拍摄全景/细节/管线点位照片","记录结构与机电现状","输出测量记录册"],
    3: ["平面布局与动线推敲","功能分区与桌椅排布","给业主方案汇报","业主修改意见确认","平面方案前测·动线模拟"],
    4: ["SketchUp 空间体块建模","场景与相机视角搭建","材质初步贴面","立面推敲与造型深化"],
    5: ["灯光氛围渲染","关键视角出图","材质色彩终选呈现","业主审美确认与局部调整"],
    6: ["平面图全套深化","立面图绘制","剖面图绘制","水电点位图","吊顶/地面节点大样","出图自审与会审"],
    7: ["主材软装选样定版","样品封样确认","供应商比价","下单跟催","输出《材料下单表》"],
    8: ["施工交底与图纸答疑","水电验收巡场","瓦木油验收陪同","竣工验收","整改销项跟进","结算配合"],
    9: ["完工摄影安排","回访拍摄安排","软陈摆场收尾","案例复盘归档"],
}

def build_project(pid, name, ptype, client, addr, amount, cover_color,
                  start_at, end_at, today_seg, done_before, delayed_segs=()):
    """按「今天落位」精确分配各段日期。
    today_seg = 今天应落入的段号（1..9）；done_before = 今天之前已完成到第几段；
    delayed_segs = 标记为延期的段号集合。
    日期分配：让当前段刚好包含今天 2026-08-29，其前面的段在昨天前结束，后面的在明天后开始。
    """
    n = len(INDOOR9)
    # 关键：让 today_seg 段的区间包含今天。前面段昨天结束，后面段明天开始。
    seg_end = {}   # seg -> (start, end)
    # 构造 9 段连续日期轴：以今天为中心，当前段 [d(-2), d(2)]，各段等宽 5 天，向前后铺开
    # 段 i（0-index）中心 = d(today_seg - (i+1)) * 5；简单化：用相对今天偏移
    # 我们采用锚点法：当前段片段宽度 W=16天，段与段首尾相接
    W = 16
    # 当前段索引 cur_idx = today_seg-1，其结束日应稍晚于今天
    # 令 cur 段： [today-4, today+11]（共16天，包含今天）
    cur_start = d(-4)
    cur_end = d(11)
    seg_end[today_seg] = (cur_start, cur_end)
    # 往前铺：第 i 段结束 = 下一段开始 - 1
    for i in range(today_seg - 1, 0, -1):
        nxt_start = seg_end[i + 1][0]
        nxt_days = (datetime.date.fromisoformat(nxt_start) - datetime.date.fromisoformat(seg_end[today_seg][0])).days
        # 前一段等宽
        prev_end = (datetime.date.fromisoformat(nxt_start) - datetime.timedelta(days=1)).isoformat()
        prev_start = (datetime.date.fromisoformat(prev_end) - datetime.timedelta(days=W - 1)).isoformat()
        seg_end[i] = (prev_start, prev_end)
    # 往后铺：第 i 段开始 = 前一段结束 + 1
    for i in range(today_seg + 1, n + 1):
        prev_end = seg_end[i - 1][1]
        nxt_start = (datetime.date.fromisoformat(prev_end) + datetime.timedelta(days=1)).isoformat()
        nxt_end = (datetime.date.fromisoformat(nxt_start) + datetime.timedelta(days=W - 1)).isoformat()
        seg_end[i] = (nxt_start, nxt_end)

    projects.append({
        "id": pid, "name": name, "type": ptype, "address": addr, "clientName": client,
        "contractAmount": amount, "signedAt": iso(start_at), "plannedStartAt": start_at,
        "plannedEndAt": end_at, "coverColor": cover_color, "stagePresetKey": "indoor_full",
        "stageTemplateVersion": 1, "scheduleBasis": "calendar", "status": "active",
        "revision": 1, "updatedAt": NOW,
    })
    owner_seq = ["mem_admin","mem_karina","mem_admin","mem_winter","mem_winter",
                 "mem_giselle","mem_jisoo","mem_rose","mem_lisa"]
    for i, (tkey, sname, ratio, cidx) in enumerate(INDOOR9):
        seg_num = i + 1
        s = seg_end[seg_num]
        if seg_num <= done_before:
            status = "completed"
        elif seg_num == today_seg:
            status = "in_progress"
        elif seg_num in delayed_segs:
            status = "delayed"
        else:
            status = "not_started"
        stages.append({
            "id": f"{pid}_s{seg_num}", "projectId": pid, "orderIndex": seg_num, "templateKey": tkey,
            "colorIndex": cidx, "name": sname, "ratioPercent": ratio,
            "startAt": s[0], "endAt": s[1], "status": status,
            "ownerId": owner_seq[i], "visible": True, "resourcePath": None,
            "revision": 1, "updatedAt": NOW,
        })
    return seg_end

# 关键字 → 专业岗成员：保证朴宁宁(软装) / 金珍妮(项目助理) 等每个人都有真实任务
# 优先级高于「段主理人」，命中即替换/追加指派；未命中回落到段主理人。
KEYWORD_OWNER = {
    "软装": "mem_ningning", "陈设": "mem_ningning", "摆场": "mem_ningning", "封样": "mem_ningning",
    "预约": "mem_jennie", "联系": "mem_jennie", "跟催": "mem_jennie", "安排": "mem_jennie",
    "采购": "mem_jennie", "报送": "mem_jennie", "记录": "mem_jennie", "复核": "mem_jennie",
    "摄影": "mem_lisa", "拍摄": "mem_lisa", "回访": "mem_lisa", "复盘": "mem_lisa",
    "现场": "mem_rose", "验收": "mem_rose", "巡场": "mem_rose", "交底": "mem_rose", "整改": "mem_rose",
    "选样": "mem_jisoo", "封样确认": "mem_jisoo", "比价": "mem_jisoo", "材料": "mem_jisoo",
    "渲染": "mem_winter", "出图": "mem_winter", "模型": "mem_winter", "光影": "mem_winter", "空间": "mem_winter",
    "图纸": "mem_giselle", "剖面": "mem_giselle", "节点": "mem_giselle", "深化": "mem_giselle", "会审": "mem_giselle",
    "方案": "mem_karina", "平面": "mem_karina", "动线": "mem_karina", "布局": "mem_karina", "意向": "mem_karina", "概念": "mem_karina",
    "合同": "mem_admin", "报价": "mem_admin", "概算": "mem_admin", "签约": "mem_admin", "业主确认": "mem_admin",
}

def assignee_for(title: str, owner_default: str) -> str:
    """按任务标题关键字挑专业岗成员；无命中回落到段主理人。"""
    for kw, mid in KEYWORD_OWNER.items():
        if kw in title:
            return mid
    return owner_default

def build_tasks(pid, seg_end, today_seg, done_before):
    """为每段挂任务；今天前的段已标完成；未完成段按关键字指派真实负责人。
    保证「方案前测」等相关任务不被截断，且每位成员（含软装/项目助理）都有真实任务。
    """
    for i, (tkey, sname, ratio, cidx) in enumerate(INDOOR9):
        seg_num = i + 1
        stg_id = f"{pid}_s{seg_num}"
        owner_default = owner_seq[i]
        pool = TASK_POOL[seg_num]
        done = seg_num <= done_before
        # 每段挂 2-4 个任务；但必须保住含「前测」的任务（用户点名）。先取前4，若前测被截断则并入。
        take = pool[:min(4, len(pool))]
        if not any("前测" in t for t in take):
            extra = [t for t in pool if "前测" in t]
            if extra:
                take = take + extra[:1]  # 追加首个前测任务
        # 给未完成阶段，任务里挑一半标完成（现实感），剩余未完成
        for j, t in enumerate(take):
            t_done = done
            if not done and (seg_num == today_seg and j < len(take) // 2):
                t_done = True  # 当前进行中段：部分任务已完成
            if not done and seg_num > today_seg:
                t_done = False  # 未来段：未完成
            mid = assignee_for(t, owner_default)
            tasks.append({
                "id": f"{pid}_t{seg_num}_{j+1}", "projectId": pid, "stageId": stg_id,
                "title": t, "done": t_done, "assigneeId": mid,
                "assigneeIds": [mid] if mid else [], "dueDate": seg_end[seg_num][1],
                "orderIndex": j+1, "revision": 1, "updatedAt": NOW,
            })

owner_seq = ["mem_admin","mem_karina","mem_admin","mem_winter","mem_winter",
             "mem_giselle","mem_jisoo","mem_rose","mem_lisa"]

# ============ 项目 1：待启动（todo）—— 云栖·湖畔茶室（刚签合同，未开始） ============
# plannedStartAt 在未来，从项目状态看未开始
p1 = "proj_yunqi"
seg1 = build_project(
    p1, "云栖·湖畔茶室", "tea_space", "周女士", "成都市锦江区东湖公园南侧", 32000, "amber",
    start_at="2026-09-05",  # 未来才开始 → 项目未开始 → todo
    end_at="2026-12-05",
    today_seg=1, done_before=0,
)
build_tasks(p1, seg1, today_seg=1, done_before=0)

# ============ 项目 2：设计中（design，orderIndex<=3）—— 川悦·川味小馆（平面方案③） ============
# 今天落在第③段平面方案 → design 列；方案前测体现在①提案/②测量/③平面方案已推进
p2 = "proj_chuanyue"
seg2 = build_project(
    p2, "川悦·川味小馆", "dining", "刘老板", "成都市武侯区桐梓林北路 88 号", 45000, "clay",
    start_at=d(-49), end_at=d(95),
    today_seg=3, done_before=2,   # ①提案②测量完成，③平面方案进行中
)
build_tasks(p2, seg2, today_seg=3, done_before=2)

# ============ 项目 3：深化中（deepen，orderIndex 4-6）—— 半山·云栖民宿（效果图⑤） ============
# 今天落在第⑤段效果图 → deepen 列；④SU建模已完成
p3 = "proj_banshan"
seg3 = build_project(
    p3, "半山·云栖民宿", "homestay", "陈先生", "青城山镇南麓半山村 12 号", 58000, "pine",
    start_at=d(-66), end_at=d(79),
    today_seg=5, done_before=4,   # ①-④完成，效果图进行中
)
build_tasks(p3, seg3, today_seg=5, done_before=4)

# ============ 项目 4：施工中（build，orderIndex>=7）—— 森屿·社区书店（材料表⑦ + 交付⑧进行） ============
# 今天落在第⑦材料表 → build 列；⑥施工图完成，⑦进行中，⑧交付延期
p4 = "proj_senyu"
seg4 = build_project(
    p4, "森屿·社区书店", "bookstore", "方老师", "成都市高新区天府三街 199 号", 36000, "cream",
    start_at=d(-94), end_at=d(60),
    today_seg=7, done_before=6, delayed_segs=(8,),   # 材料表进行中，交付延期
)
build_tasks(p4, seg4, today_seg=7, done_before=6)

# ============ 项目 5：全部完成（build 列）—— 初见·精品民宿（已交付完） ============
# 全部阶段 completed → 施工中列（历史已完结项目，进入作品集归档）
p5 = "proj_chujian"
seg5 = build_project(
    p5, "初见·湖畔民宿", "homestay", "林女士", "成都市龙泉驿区洛带古镇", 52000, "pine",
    start_at=d(-160), end_at=d(-5),
    today_seg=9, done_before=9,   # 全部完成（含实景拍摄）
)
build_tasks(p5, seg5, today_seg=9, done_before=9)

# ---------------- 流水（状态流转 + 改期 + 延期） ----------------
def s_log(lid, stage_id, pid, typ, frm, to, op, old=None, new=None):
    logs.append({
        "id": lid, "stageId": stage_id, "projectId": pid, "type": typ,
        "fromStatus": frm, "toStatus": to, "oldStartAt": old, "newStartAt": None,
        "oldEndAt": old, "newEndAt": new, "reason": "合同书约定工期顺延" if new else None,
        "operatorName": op, "createdAt": NOW,
    })
# 项目2：平面方案从测量后开始 + 提案完成
s_log("log_p2a", f"{p2}_s1", p2, "status_changed", "not_started", "completed", "设计师本人")
s_log("log_p2b", f"{p2}_s3", p2, "status_changed", "not_started", "in_progress", "设计师本人")
# 项目3：效果图开始
s_log("log_p3a", f"{p3}_s5", p3, "status_changed", "not_started", "in_progress", "金敏珍")
# 项目4：材料表进行中 + 交付延期 + 一次改期
s_log("log_p4a", f"{p4}_s7", p4, "status_changed", "not_started", "in_progress", "金智秀")
s_log("log_p4b", f"{p4}_s8", p4, "status_changed", "not_started", "delayed", "朴彩英")
s_log("log_p4c", f"{p4}_s8", p4, "rescheduled", None, None,
      "设计师本人", seg4[8][0], seg4[8][1])

# ---------------- 任务指派流水 ----------------
assignments = [
    {"id":"log_a1","taskId":f"{p2}_t3_1","projectId":p2,"memberId":"mem_admin",
     "action":"assign","operatorName":"设计师本人","createdAt":NOW},
    {"id":"log_a2","taskId":f"{p3}_t5_1","projectId":p3,"memberId":"mem_winter",
     "action":"assign","operatorName":"设计师本人","createdAt":NOW},
    {"id":"log_a3","taskId":f"{p4}_t7_1","projectId":p4,"memberId":"mem_jisoo",
     "action":"assign","operatorName":"设计师本人","createdAt":NOW},
    {"id":"log_a4","taskId":f"{p4}_t8_1","projectId":p4,"memberId":"mem_rose",
     "action":"change","operatorName":"设计师本人","createdAt":NOW},
]

# ---------------- 合同（p2/p4 各一份） ----------------
def mk_contract(cid, pid, pname, amount, client, addr, start_at, end_at, fname):
    return {"id": cid, "projectId": pid, "fileName": fname,
        "rawTextDigest": "a1b2c3d4e5f60718",
        "parsedResultJson": json.dumps({"projectName": pname, "amount": amount}, ensure_ascii=False),
        "confirmedPayloadJson": json.dumps(
            {"projectName": pname, "projectType": "dining" if "馆" in pname else "homestay",
             "address": addr, "clientName": client, "contractAmount": amount,
             "signedAt": iso(start_at), "startAt": start_at, "endAt": end_at,
             "createdByManual": True, "sourceFileName": fname}, ensure_ascii=False),
        "createdByManual": True, "createdAt": NOW}

contracts = [
    mk_contract("ctt_p2", p2, "川悦·川味小馆", 45000, "刘老板",
                "成都市武侯区桐梓林北路 88 号", d(-49), d(95), "川味小馆-装修合同.pdf"),
    mk_contract("ctt_p4", p4, "森屿·社区书店", 36000, "方老师",
                "成都市高新区天府三街 199 号", d(-94), d(60), "社区书店-装修合同.pdf"),
]

# ---------------- 设置 ----------------
settings = [
    {"key":"currentMemberId","valueJson":json.dumps("mem_admin"),"updatedAt":NOW},
    {"key":"restPolicy","valueJson":json.dumps({"kind":"double_off","anchorWeek":None}),"updatedAt":NOW},
]

pkg = {
    "meta":{"app":"changxia","schemaVersion":3,"exportedAt":NOW},
    "data":{
        "projects":projects,"stages":stages,"tasks":tasks,"members":members,
        "assignments":assignments,"logs":logs,"contracts":contracts,"settings":settings,
    },
}

# ★ 0.8.3：产物进仓库 public/（随前端包分发；文件名语义化，无日期后缀——
#   动态日期锚后同一文件每次重新生成即可，不留历史版本）。
import os
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "demo-backup.json")
with open(out,"w",encoding="utf-8") as f:
    json.dump(pkg,f,ensure_ascii=False,indent=2)

# ---- 落位自检：打印每个项目的当前列（今天落位逻辑） ----
def current_seg_of(p):
    for s in sorted([x for x in stages if x["projectId"]==p["id"]], key=lambda x:x["orderIndex"]):
        if s["status"] != "completed" and TODAY >= s["startAt"][:10] and TODAY <= s["endAt"][:10]:
            return s["orderIndex"]
    # 取最近的未完成
    nx = [s for s in stages if s["projectId"]==p["id"] and s["status"] != "completed"]
    nx.sort(key=lambda x:x["orderIndex"])
    return nx[0]["orderIndex"] if nx else 9

def col_of(p):
    from datetime import date
    start = p["plannedStartAt"][:10]
    if TODAY < start: return "todo"
    if all(s["status"]=="completed" for s in stages if s["projectId"]==p["id"]): return "build"
    idx = current_seg_of(p)
    return "design" if idx<=3 else ("deepen" if idx<=6 else "build")

print("projects:",len(projects),"stages:",len(stages),"tasks:",len(tasks),
      "members:",len(members),"logs:",len(logs),"contracts:",len(contracts))
for p in projects:
    idx = current_seg_of(p)
    print(f"  {p['name']:12s} 当前段={idx} 列={col_of(p):7s} 状态集=",
          sorted(set(s['status'] for s in stages if s['projectId']==p['id'])))
