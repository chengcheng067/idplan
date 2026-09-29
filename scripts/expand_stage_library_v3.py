# -*- coding: utf-8 -*-
"""0.8.4 行业扩展生成器：五行业各补 1-2 个细分套餐（+11 items / +8 presets）。

一次性脚本（产物已落 templates/stage-library.json）；保留作审计痕迹：
改阶段库必经本文件或同规格校验（itemKeys 可解析 / kanbanColumn 合法 /
colorIndex 1-9 / key 无重）——与 templates 的 validate_templates.py 互补。
"""
import json
from collections import Counter

P = "templates/stage-library.json"
d = json.load(open(P, encoding="utf-8"))
items, presets = d["items"], d["presets"]
assert not any(i["key"] == "software.outsource_scope" for i in items), "已扩过，勿重复"

NEW_ITEMS = [
  dict(key="software.outsource_scope", name="外包范围与报价", domain="software", ratioPercent=10,
       colorIndex=4, kanbanColumn="planning",
       defaultResponsibility="外包范围切分；供应商询价比价；里程碑与付款节点；输出外包合同",
       defaultTasks=["外包范围切分", "供应商询价比价", "里程碑与付款节点", "输出外包合同"]),
  dict(key="software.api_integration", name="第三方对接", domain="software", ratioPercent=8,
       colorIndex=8, kanbanColumn="developing",
       defaultResponsibility="第三方接口调研；联调与 mock；异常与限流处理；输出联调报告",
       defaultTasks=["第三方接口调研", "联调与 mock", "异常与限流处理", "输出联调报告"]),
  dict(key="software.mobile_adapt", name="移动端适配", domain="software", ratioPercent=7,
       colorIndex=9, kanbanColumn="testing",
       defaultResponsibility="多机型兼容测试；性能与包体积；应用市场材料；提交审核",
       defaultTasks=["多机型兼容测试", "性能与包体积", "应用市场材料", "提交审核"]),
  dict(key="marketing.launch_run", name="发布会执行", domain="marketing", ratioPercent=12,
       colorIndex=4, kanbanColumn="live",
       defaultResponsibility="流程彩排；现场控场；媒体接待；突发预案启动",
       defaultTasks=["流程彩排", "现场控场", "媒体接待", "突发预案启动"]),
  dict(key="marketing.expo_design", name="展位设计", domain="marketing", ratioPercent=10,
       colorIndex=2, kanbanColumn="prep",
       defaultResponsibility="展位平面与动线；效果图；搭建商技术交底；报馆审批",
       defaultTasks=["展位平面与动线", "效果图", "搭建商技术交底", "报馆审批"]),
  dict(key="marketing.media_plan", name="媒介投放计划", domain="marketing", ratioPercent=10,
       colorIndex=7, kanbanColumn="promo",
       defaultResponsibility="媒介组合与预算分配；投放排期；素材规格清单；效果监测位",
       defaultTasks=["媒介组合与预算分配", "投放排期", "素材规格清单", "效果监测位"]),
  dict(key="film.storyboard_anim", name="动态分镜", domain="film", ratioPercent=10,
       colorIndex=3, kanbanColumn="preprod",
       defaultResponsibility="关键帧动态预演；镜头时长与转场；音乐参考定位；客户预演确认",
       defaultTasks=["关键帧动态预演", "镜头时长与转场", "音乐参考定位", "客户预演确认"]),
  dict(key="film.series_script", name="系列选题与脚本", domain="film", ratioPercent=12,
       colorIndex=1, kanbanColumn="preprod",
       defaultResponsibility="选题库与排期；单集脚本模板化；拍摄批次数规划；发布节奏设计",
       defaultTasks=["选题库与排期", "单集脚本模板化", "拍摄批次数规划", "发布节奏设计"]),
  dict(key="wedding.destination_plan", name="目的地统筹", domain="wedding", ratioPercent=10,
       colorIndex=6, kanbanColumn="planning",
       defaultResponsibility="目的地比选与踏勘；宾客差旅方案；天气与许可证；应急预案",
       defaultTasks=["目的地比选与踏勘", "宾客差旅方案", "天气与许可证", "应急预案"]),
  dict(key="wedding.guest_manage", name="宾客统筹", domain="wedding", ratioPercent=8,
       colorIndex=8, kanbanColumn="prep",
       defaultResponsibility="邀请与回执统计；座位与动线；接送与住宿分配；现场签到方案",
       defaultTasks=["邀请与回执统计", "座位与动线", "接送与住宿分配", "现场签到方案"]),
  dict(key="consulting.train", name="培训赋能", domain="consulting", ratioPercent=10,
       colorIndex=9, kanbanColumn="delivery",
       defaultResponsibility="内部讲师培养；操作手册与工具模板；陪跑答疑机制；能力验收",
       defaultTasks=["内部讲师培养", "操作手册与工具模板", "陪跑答疑机制", "能力验收"]),
]

NEW_PRESETS = [
  dict(key="software_outsource_full", name="软件外包·全交付", domain="software",
       itemKeys=["software.discovery", "software.prd", "software.outsource_scope", "software.uidesign",
                 "software.dev", "software.api_integration", "software.qa", "software.handover"],
       description="外包与被外包两个视角通用的交付主线：范围先行、联调解耦、验收闭环，适合甲方管外部团队"),
  dict(key="software_mobile_full", name="移动应用·专项", domain="software",
       itemKeys=["software.discovery", "software.prd", "software.uidesign", "software.dev",
                 "software.api_integration", "software.qa", "software.mobile_adapt", "software.launch"],
       description="iOS / Android 双端上架主线：在通用流程外补齐第三方对接、多机型适配与市场审核"),
  dict(key="marketing_launch_full", name="发布会·全流程", domain="marketing",
       itemKeys=["marketing.brief", "marketing.strategy", "marketing.media_plan", "marketing.asset",
                 "marketing.vendor", "marketing.launch_run", "marketing.review"],
       description="新品发布会主线：媒介计划前置，现场执行独立成段，媒体接待与突发预案有专口"),
  dict(key="marketing_expo_full", name="展会快闪·全流程", domain="marketing",
       itemKeys=["marketing.brief", "marketing.strategy", "marketing.expo_design", "marketing.asset",
                 "marketing.vendor", "marketing.promo", "marketing.onsite", "marketing.review"],
       description="展会与快闪店主线：展位设计含报馆审批节点，预热推广按档期倒排"),
  dict(key="film_promo_full", name="宣传片·全流程", domain="film",
       itemKeys=["film.script", "film.casting", "film.prep", "film.storyboard_anim",
                 "film.shoot", "film.edit1", "film.edit2", "film.deliver"],
       description="宣传片主线：动态分镜预演先行，客户在拍摄前看到成片节奏，减少返工"),
  dict(key="film_series_full", name="短视频系列", domain="film",
       itemKeys=["film.series_script", "film.prep", "film.shoot", "film.edit1", "film.deliver"],
       description="系列短视频批产主线：选题库+模板化脚本+集中拍摄，按发布节奏滚动推进"),
  dict(key="wedding_destination_full", name="目的地婚礼", domain="wedding",
       itemKeys=["wedding.brief", "wedding.destination_plan", "wedding.concept", "wedding.vendor",
                 "wedding.guest_manage", "wedding.asset", "wedding.rehearsal", "wedding.onsite", "wedding.deliver"],
       description="目的地婚礼主线：差旅统筹与宾客管理独立成段，天气/许可证/应急预案有专节点"),
  dict(key="consulting_resident_full", name="咨询·驻场陪跑", domain="consulting",
       itemKeys=["consulting.kickoff", "consulting.research", "consulting.design", "consulting.review",
                 "consulting.train", "consulting.landing", "consulting.close"],
       description="驻场陪跑主线：方案之外补培训赋能段，客户团队能自己接住才算结项"),
]

items.extend(NEW_ITEMS)
presets.extend(NEW_PRESETS)
d["version"] = 3
d["source"] = (d.get("source", "") + "；v3 扩五行业细分套餐（软件/市场/影视/婚礼/咨询各 +1~2，新 11 items + 8 presets）").strip("；")
json.dump(d, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# 落库校验
keys = [i["key"] for i in items]
assert len(keys) == len(set(keys)), "item key 重复"
cols = {k: {c["key"] for c in d["domains"][k]["columns"]} for k in d["domains"]}
for i in items:
    assert i["kanbanColumn"] in cols[i["domain"]], "非法 kanbanColumn: " + i["key"]
    assert 1 <= i["colorIndex"] <= 9, "非法 colorIndex: " + i["key"]
ks = set(keys)
for pr in presets:
    for k in pr["itemKeys"]:
        assert k in ks, "preset %s 引用不存在 item %s" % (pr["key"], k)
print("OK items:", len(items), "presets:", len(presets))
print("per domain:", dict(Counter(p["domain"] for p in presets)))
