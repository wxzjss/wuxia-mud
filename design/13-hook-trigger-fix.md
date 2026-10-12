# 画像钩子 · 触发条件修复台账（2026-10-13）

## 背景
主人报：「一些剧情没完成、AI 味太重」。
排查发现：**33 个画像钩子（portrait.hooks）的 trigger 引用了全库从未设置的 flag**
→ 玩家把相关事全办完，钩子依然恒显示「交情还不够（先替他办点事）」，**永远问不出来**。

## 定性
- 33 条全部形如 `{"and":[{trust门槛},{flag: X}]}`，X 是从未被设置的 flag。
- 其中 27 条 X 写错了名字，**同一件事的结局 flag 其实存在**（命名对得上）→ 属笔误类 bug，可精确修复。
- 剩 6 条 X 无任何对口机制（动作引擎不支持）→ 降级为只留 trust 门槛。

## 一、精确修复（27 条）：把错名换成本事结局 flag

| 钩子 | 标题 | 错名 | 改为 |
|---|---|---|---|
| hk_npcv_009_shuoshu | 说书人那张嘴 | know_shuoshu | hk_npcv_009_shuoshu_buy |
| hk_npcv_036_kai | 书里夹着的那页纸 | know_fanxiang | hk_npcv_036_kai_grey |
| hk_npcv_074_qian | 偷换的那坛酒 | know_qiangqiu | hk_npcv_074_qian_clear |
| hk_npcv_082_hua | 书房里那幅画 | know_huashan | hk_npcv_082_hua_clear |
| hk_npcv_083_gaizi | 改过的那行字 | know_gaizi | hk_npcv_083_gaizi_clear |
| hk_npcv_090_meimei | 妹妹那碗药 | met_ruanting_mei | hk_npcv_090_meimei_tell |
| hk_npcv_091_mianao | 两个小子的棉袄 | know_xiaozai | hk_npcv_091_mianao_school |
| hk_npcv_095_shifu | 师父那句「莫争」 | qi_done | hk_npcv_095_shifu_end |
| hk_npcv_102_kaiti | 买过的考题 | met_xuezheng | hk_npcv_102_kaiti_report |
| hk_npcv_109_jiuyi | 货栈里的旧冬衣 | entered_huozhan | hk_npcv_109_jiuyi_done |
| hk_npcv_115_ce | 册子上那个名字 | know_huolang | hk_npcv_115_ce_grey |
| hk_npcv_126_tongxiang | 那尊铜像 | know_tongxiang | hk_npcv_126_tongxiang_back |
| hk_npcv_154_suoyin | 素银簪 | maishen_done | hk_npcv_154_suoyin_grey |
| hk_npcv_164_sirenzhang | 死人账 | know_sirenzhang | hk_npcv_164_sirenzhang_expose |
| hk_npcv_174_zhangxin | 掌心里那把米 | tuntang_done | hk_npcv_174_zhangxin_grey |
| hk_npcv_178_jiao | 剩下的那半个角 | know_yaopopo | hk_npcv_178_jiao_grey |
| hk_npcv_181_guanliang | 官粮案的旧账 | trust_npcv_181_ge_60 | hk_npcv_181_guanliang_admit |
| hk_npcv_186_yao | 那味哑药 | know_wangqiu | hk_npcv_186_yao_clear |
| hk_npcv_208_shaochuan | 十年前那条船 | know_shaochuan | hk_npcv_208_shaochuan_report |
| hk_npcv_215_mengming | 孟明亡母那笔钱 | know_mengming | hk_npcv_215_mengming_tell |
| hk_npcv_223_laoxiapo | 城外那个瞎婆 | know_laoxiapo | hk_npcv_223_laoxiapo_ack |
| hk_npcv_237_cheng | 秤砣上那点尘 | know_yizhuang | hk_npcv_237_cheng_grey |
| hk_npcv_240_shouyi | 箱底那件料子 | know_shouyi | hk_npcv_240_shouyi_wear |
| hk_npcv_241_guancai | 寄在他这儿的棺材本 | know_kangshou | hk_npcv_241_guancai_done |
| hk_npcv_248_changfu | 关外那个孩子 | met_changfu | hk_npcv_248_changfu_clear |
| hk_npcv_252_zi | 枕下那个字 | know_meishi | （无对口，降级） |
| hk_npcv_180_qi | 车上那面旧旗 | know_jieqi | （无对口，降级） |

## 二、降级为只留 trust（6 条，引擎无对应机制）
| 钩子 | 标题 | 原 flag |
|---|---|---|
| hk_yaopopo_cezi | 血写的册子 | shanzhong_du_done |
| hk_npcv_024_cezi | 册子上的第十一个字 | beat_jiangtingzhou（需「切磋获胜」机制，暂缺） |
| hk_npcv_027_jianwang | 没死的那个死人 | got_miaoqi |
| hk_npcv_065_ziju | 怀里那张字据 | know_guanjin |
| hk_miejue_shixiong | 四次的其中一次 | met_weizhou |
| hk_huangyaoshi_kongfen | 坟里没有人 | entered_taohuadao |
| hk_npcv_252_zi | 枕下那个字 | know_meishi |
| hk_npcv_180_qi | 车上那面旧旗 | know_jieqi |

（注：共 8 条走降级；精确修复 25 条。）
