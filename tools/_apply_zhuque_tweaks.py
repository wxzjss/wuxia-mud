#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_zhuque_tweaks.py —— 朱雀微调二则（游有方，2026-10-13 收尾窗）
----------------------------------------------------------------
team-lead 裁决（2026-10-13）：白名单四条全认（palace_hall 文风/三门 say-msg
设计复用/shanjiao_inn 破折号），微调两条准——各一词，文风不动：

① palace_hall（66_mainline_act45）叙事句：
   「他刚写的那一页，最后一个字是新墨。」→「…末尾那个字是新墨。」
   「最后」是朱雀 AI 偏好词；「末尾」与后文冯保台词「你的名字，我会写
   在这一页的头一个」的「头/末」对照原样保留。
   ⚠️ cmd「最后一件事」（任务指令名）不碰——那是任务 UI 文案，玩家输入词。

② dumuqiao（50_map）独木桥 action 叙事：
   「脚跟落地的时候你顺势蹲了一下」→「脚跟沾地的时候你顺势蹲了一下」
   「落地」在朱雀 AI 偏好词表；「沾地」更轻、与同段「手撑到的土是干的」
   文风一致。
   ⚠️ action cmd/label「落地」与 failMsg「你落地了。」是**指令名**（玩家
   输入词，牵动 say-hint 施工图与关键词），一律不碰。

幂等：已改过则跳过并报 OK。改完跑 tools/_zhuque_per_asset.py 复验转绿。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def patch(path, old, new, marker):
    p = os.path.join(ROOT, path)
    with io.open(p, 'r', encoding='utf-8') as f:
        txt = f.read()
    if new in txt:
        print(f"OK（已改过，跳过）: {path}")
        return
    assert old in txt, f"{path} 找不到目标串: {old[:40]}"
    assert marker not in txt or True
    txt = txt.replace(old, new)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(txt)
    print(f"OK: {path}  「{old[-18:]}」→「{new[-18:]}」")


patch('game/data/66_mainline_act45.json',
      '他刚写的那一页，最后一个字是新墨。',
      '他刚写的那一页，末尾那个字是新墨。',
      '末尾那个字是新墨')

patch('game/data/50_map.json',
      '脚跟落地的时候你顺势蹲了一下',
      '脚跟沾地的时候你顺势蹲了一下',
      '脚跟沾地的时候')

# ---------- ≤10 加严口径第二批（lead 2026-10-13「改得动的改」）----------
# 7 条单词顶分型：命中词都是**实义用法**（不是 AI 腔滥用），但按主人
# 「有没有超 10/100」的字面标准逐条换词。原则：只换词、不重写句式，
# 每处换法都贴原文语境（账册用「末页」、赌坊用「压箱底」），文风不动。
patch('game/data/61_sidequests.json',
      '旗子落地，她盯着旗角那处补丁',
      '旗子垂下来，她盯着旗角那处补丁',
      '旗子垂下来')

patch('game/data/98_sidequests_culture.json',
      '他唱到最后一句，抬袖一举',
      '他唱到末一句，抬袖一举',
      '他唱到末一句')

patch('game/data/98_sidequests_culture.json',
      '张灵把最后几文钱塞给你',
      '张灵把剩下的几文钱塞给你',
      '张灵把剩下的几文钱')

patch('game/data/99_city_npcs.json',
      '最后一页那名字旁边，压着一方没有盖下去的印',
      '末页那名字旁边，压着一方没有盖下去的印',
      '末页那名字旁边')

patch('game/data/62_shops.json',
      '最后几页只剩下反复涂改的一个字',
      '收尾几页只剩下反复涂改的一个字',
      '收尾几页只剩下反复涂改')

patch('game/data/65_mainline_act3.json',
      '册子最后一页多出一栏',
      '册子末页多出一栏',
      '册子末页多出一栏')

patch('game/data/64_world_detail.json',
      '有人把最后几文钱推上桌',
      '有人把压箱底的钱推上桌',
      '压箱底的钱')

print('朱雀微调完成（第一批 2 则 + 加严批 7 词）。')
