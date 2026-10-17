#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_canon_write.py —— 数据落盘 canonical writer（唯一天真源）
----------------------------------------------------------------
为什么要它（2026-10-18，一次红发布门禁换来的）：
  各 apply 脚本原先各自 `json.dump(..., indent=2) + '\n'`，而各文件的
  canonical 格式**并不统一**：40_npcs 是缩进 1、无尾换行；20_items 是缩进 2、有尾换行；
  60_quests / 73_sects_place 是 CRLF + 缩进 2。写错格式不报错、数据照样能读，
  只会红 `data-write-guard --check` 与 `smoke-portrait-batch` 的逐字节断言。

口径（唯一真相源 = `tools/data-format-baseline.json`，由严过关的守卫维护）：
  每个文件的 `width`（缩进宽度）/ `eol`（\n 或 \r\n）/ `trailing`（末尾是否换行）/ `bom`
  照抄基线，不再在脚本里硬编码。

用法：
  from _canon_write import write_canon
  write_canon('60_quests.json', doc)        # 相对 game/data
  write_canon('/abs/path.json', doc)        # 绝对路径
"""
import json, os

_TOOLS = os.path.dirname(os.path.abspath(__file__))
_BASE_PATH = os.path.join(_TOOLS, 'data-format-baseline.json')
_DATA = os.path.join(_TOOLS, '..', 'game', 'data')
_cache = None

def baseline():
    global _cache
    if _cache is None:
        with open(_BASE_PATH, encoding='utf-8') as f:
            j = json.load(f)
        _cache = j.get('files') or j
    return _cache

def write_canon(path, obj, base_dir=None):
    """按基线格式写盘：缩进/换行/尾换行/BOM 全部照 `data-format-baseline.json`。"""
    p = path
    if not os.path.isabs(p):
        p = os.path.join(base_dir or _DATA, p)
    fp = baseline().get(os.path.basename(p)) or {}
    width = fp.get('width') or 1
    eol = fp.get('eol') or '\n'
    trailing = bool(fp.get('trailing'))
    bom = bool(fp.get('bom'))
    s = json.dumps(obj, ensure_ascii=False, indent=width)
    if eol != '\n':
        s = s.replace('\n', eol)
    if trailing:
        s += eol
    data = (b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8')
    with open(p, 'wb') as f:
        f.write(data)
    return p

if __name__ == '__main__':
    # 自检：对每个基线文件做一次 parse→write_canon，canonical 文件必须字节一致
    import io, sys
    bad = []
    for name, fp in sorted(baseline().items()):
        p = os.path.join(_DATA, name)
        if not os.path.exists(p):
            continue
        raw = open(p, 'rb').read()
        obj = json.loads(raw.decode('utf-8-sig'))
        import tempfile, shutil
        tmp = os.path.join(tempfile.gettempdir(), name)
        shutil.copyfile(p, tmp)
        write_canon(tmp, obj)
        after = open(tmp, 'rb').read()
        if fp.get('canonical') and raw != after:
            bad.append(name)
    print('canonical 逐字节自检：', '全过' if not bad else ('不一致: ' + ', '.join(bad)))
    sys.exit(1 if bad else 0)
