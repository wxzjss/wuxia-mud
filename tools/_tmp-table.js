'use strict';
const path = require('path');
const { GameEngine } = require(path.join(process.cwd(), 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;

/* 逐条：qid -> [取材的画像字段, 判定, 理由]（人工读后判定） */
const M = {
  hk_npcv_241_yinzi: ['now·secret', '匹配', '亏空＝now「绸缎庄三百两窟窿」；棺材本转借＝secret'],
  hk_npcv_241_guancai: ['secret·feuds', '匹配', '三笔没动的账＝secret「拿棺材本转借」；康守＝feuds 里唯一敢劝他的人'],
  hk_npcv_154_maishen: ['now·secret', '匹配', '姑娘绝食＝now；卖身契＝secret。（地理存疑，见不真实感 §3.1）'],
  hk_npcv_154_suoyin: ['origin·want', '匹配', '三支同款簪＝want「磨软性子」；被卖身世＝origin。（地理同上一处存疑）'],
  hk_npcv_010_haosun: ['secret·now', '匹配', '耗损吞米＝secret；庞听抬价＝now。（「去书院问米价」略牵强）'],
  hk_npcv_010_fuxue: ['want', '匹配', '送子入府学＝want。（文案称「府学」，房间是「白鹿书院·讲堂」，名号不一）'],
  hk_npcv_208_feng: ['now·want', '匹配', '三条船不敢进港＝now；抽头一文不少＝want'],
  hk_npcv_208_shaochuan: ['secret', '匹配', '十年前沉船＝secret'],
  hk_npcv_091_xiangzi: ['now·want', '匹配', '府衙箱子＝now；独吞＝want'],
  hk_npcv_091_mianao: ['secret', '匹配', '两个捡来的小子＝secret'],
  hk_npcv_065_siqiliang: ['now·want·feuds', '匹配', '欠刁立＝now；再赊翻本＝want；与元若的账＝feuds'],
  hk_npcv_065_ziju: ['secret', '匹配', '官银字据揣三十年＝secret'],
  hk_npcv_223_meimei: ['want·origin', '匹配', '找人贩子问妹妹＝want；八岁被挑脚筋＝origin'],
  hk_npcv_223_laoxiapo: ['secret', '匹配', '偷来的钱全给瞎婆＝secret'],
  hk_npcv_174_tuntang: ['secret·now', '匹配', '陈米掺新＝secret；旱象压仓＝now'],
  hk_npcv_174_zhangxin: ['origin', '匹配', '抓米搓手、娘教的＝origin'],
  hk_npcv_240_laocaifeng: ['now·fear', '匹配', '掺麻的绸＝now；怕被剪开＝fear'],
  hk_npcv_240_shouyi: ['secret', '匹配', '寿衣料穿三日就烂＝secret'],
  hk_npcv_009_baizi: ['now·want', '匹配', '百子图抵债＝now；卖出十两＝want'],
  hk_npcv_009_shuoshu: ['secret', '匹配', '赖账人的名字说给说书人＝secret'],
  hk_npcv_237_daoshang: ['now·secret', '匹配', '半夜治刀伤＝now；替盗贼治伤不报官＝secret'],
  hk_npcv_237_cheng: ['origin', '匹配', '义庄验伤十年＝origin'],
  hk_npcv_248_jiushui: ['secret·feuds', '匹配', '假账害常拂顶罪＝secret+feuds'],
  hk_npcv_248_changfu: ['feuds·secret', '匹配', '常拂＝feuds；背锅旧案＝secret'],
  hk_npcv_215_yanyin: ['origin·secret', '勉强', '取材对得上（半张盐引＝origin；孟明娘的钱＝secret），但把盐务戏放在「唐门前厅」，地界与身份不合'],
  hk_npcv_215_mengming: ['secret', '匹配', '替孟明亡母出药钱＝secret'],
  hk_npcv_180_beibian: ['now·secret', '匹配', '不写货单的镖＝now；报货主名致人破亡＝secret'],
  hk_npcv_180_qi: ['origin·secret', '匹配', '借华山旗＝origin；报货主名＝secret'],
  hk_npcv_115_mingan: ['now·want', '勉强', '取材对（压案三天结案），但让捕快在「唐门前厅」查命案，与衙门身份不合'],
  hk_npcv_115_ce: ['secret', '匹配', '册上冤死的货郎＝secret'],
  hk_npcv_083_guben: ['now·want', '匹配', '孤本换判＝now；改判流放＝want'],
  hk_npcv_083_gaizi: ['secret', '匹配', '刮改判词那一行＝secret'],
  hk_npcv_126_xianghuo: ['now·want', '匹配', '香客香火＝now；赶屈弘走＝want'],
  hk_npcv_126_tongxiang: ['secret·feuds', '匹配', '偷铜像＝secret；与屈弘的怨＝feuds'],
  hk_npcv_164_yinzi: ['now·secret', '匹配', '周转银子＝now；死人账＝secret'],
  hk_npcv_164_sirenzhang: ['secret', '匹配', '账上「采买」两字买孩子命＝secret'],
  hk_npcv_186_zuihua: ['now·secret', '匹配', '雅间醉话＝now；替神教做眼＝secret'],
  hk_npcv_186_yao: ['secret·feuds', '匹配', '给汪秋下哑药＝secret；汪秋＝feuds'],
  hk_npcv_090_jieyao: ['now·want', '勉强', '蛊发＝now、换解药＝want 取材对，但菜单写「再跑一趟星宿海」，台上并无星宿海这一幕，落点只在自家摊子'],
  hk_npcv_090_meimei: ['secret', '匹配', '给亲妹妹下不死之毒＝secret'],
  hk_npcv_074_yajian: ['now·want', '匹配', '传话一两一回＝now；赎回身契＝want'],
  hk_npcv_074_qian: ['secret·feuds', '匹配', '偷换强秋的酒＝secret+feuds'],
  hk_npcv_252_minge: ['now·feuds', '匹配', '盯着梅拾换名额＝now；与梅拾之争＝feuds'],
  hk_npcv_252_zi: ['secret·origin', '匹配', '抄了位置又烧＝secret；梅拾教她认字＝origin'],
  hk_npcv_178_fangzi: ['secret', '匹配', '抄药婆婆方子卖山下＝secret'],
  hk_npcv_178_jiao: ['secret·feuds', '匹配', '撕剩下半个角＝secret；药婆婆＝feuds'],
  hk_npcv_095_qi: ['now·secret', '匹配', '清旧档＝now；月份是自己添的＝secret'],
  hk_npcv_095_shifu: ['origin·secret', '匹配', '师祖旧观＝origin；添改年份＝secret'],
  hk_npcv_036_juanzi: ['secret', '匹配', '藏樊湘一页考卷＝secret'],
  hk_npcv_036_kai: ['secret·feuds', '匹配', '夹在书里的那页＝secret；樊湘＝feuds'],
  hk_npcv_082_mibao: ['secret·now', '勉强', '取材对（密报副本＝secret），但把「皇城天牢」的老仆与「江南衙门」的元怀瑾接在一处，跨区地理不合'],
  hk_npcv_082_hua: ['secret·feuds', '勉强', '取材对（画上记事＝secret），地理同上一处不合'],
};

const hk = Object.keys(D.quests).filter(q => q.startsWith('hk_'));
const rows = [];
for (const qid of hk) {
  const q = D.quests[qid];
  const g = D.npcs[q.giver] || {};
  const m = M[qid] || ['?', '待判', ''];
  rows.push(`| \`${qid}\` | ${g.name || q.giver} | ${m[0]} | ${m[1]} | ${m[2]} |`);
}
console.log(rows.join('\n'));
