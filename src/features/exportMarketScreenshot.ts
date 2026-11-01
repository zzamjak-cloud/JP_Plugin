// 국가코드 이름의 최상위 그룹/스마트 오브젝트를 하나씩 보이게 해 JPG로 내보내기 (CAT exportMarketScreenshot.js 대응)
import { showAlert } from "../lib/lib";
import { withHistory } from "../core/bridge";
import { getLayerTree, setVisible, isGroup, isSmartObject } from "../lib/lib_layer";
import { saveForWebJPG } from "../lib/lib_export";
import { setProgress, clearProgress } from "../ui/progress";
import { docFolderAndName } from "./folderPreset";
import type { PcLayer } from "../lib/types";

export async function exportMarketScreenshot(): Promise<number> {
  try {
    // 최상위 레이어만 대상 (중첩 레이어 제외)
    const countryLayers = (await getLayerTree()).filter(isCountryLayer);
    if (countryLayers.length === 0) {
      await showAlert("국가코드 레이어가 존재하지 않습니다.");
      return 0;
    }
    const { folder, name: docName } = await docFolderAndName();
    const total = countryLayers.length;
    updateExportProgress(0, total);

    await withHistory(async () => {
      // 국가코드 레이어를 모두 숨긴다
      for (const layer of countryLayers) await setVisible(layer.id, false);
      // 하나씩 표시 → JPG 저장 → 다시 숨김 (원본처럼 끝나면 모두 숨겨진 상태)
      for (let i = 0; i < total; i++) {
        const layer = countryLayers[i];
        updateExportProgress(i, total, layer.name);
        await setVisible(layer.id, true);
        await saveForWebJPG(folder, `${docName}_${layer.name}`);
        await setVisible(layer.id, false);
        updateExportProgress(i + 1, total, layer.name);
      }
    });

    await showAlert(`${total}개 JPG 내보내기가 완료되었습니다.`);
    return total;
  } catch (e) {
    console.error("Error in exportMarketScreenshot:", e);
    await showAlert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  } finally {
    clearProgress();
  }
}

/** 진행률 표시 (CAT updateExportProgress 문구 그대로) */
function updateExportProgress(completed: number, total: number, countryCode?: string) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  let label: string;
  if (completed >= total) label = `완료 (${total}/${total})`;
  else if (countryCode) label = `내보내는 중: ${countryCode} (${completed + 1}/${total})`;
  else label = "준비 중...";
  setProgress(label, percent);
}

/** 그룹 또는 스마트 오브젝트이면서 국가코드 이름인 레이어인지 확인 */
function isCountryLayer(layer: PcLayer): boolean {
  return (isGroup(layer) || isSmartObject(layer)) && isCountryCode(layer.name);
}

// ISO 3166-1 alpha-2 국가코드 (250개)
const ISO_ALPHA2_CODES = [
    "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be",
    "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd",
    "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dj", "dk", "dm",
    "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf",
    "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu",
    "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn",
    "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me",
    "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na",
    "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm",
    "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si",
    "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk",
    "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi",
    "vn", "vu", "wf", "ws", "xk", "ye", "yt", "za", "zm", "zw"
];

// ISO 3166-1 alpha-3 국가코드 (250개)
const ISO_ALPHA3_CODES = [
    "abw", "afg", "ago", "aia", "ala", "alb", "and", "are", "arg", "arm", "asm", "ata", "atf", "atg", "aus", "aut",
    "aze", "bdi", "bel", "ben", "bes", "bfa", "bgd", "bgr", "bhr", "bhs", "bih", "blm", "blr", "blz", "bmu", "bol",
    "bra", "brb", "brn", "btn", "bvt", "bwa", "caf", "can", "cck", "che", "chl", "chn", "civ", "cmr", "cod", "cog",
    "cok", "col", "com", "cpv", "cri", "cub", "cuw", "cxr", "cym", "cyp", "cze", "deu", "dji", "dma", "dnk", "dom",
    "dza", "ecu", "egy", "eri", "esh", "esp", "est", "eth", "fin", "fji", "flk", "fra", "fro", "fsm", "gab", "gbr",
    "geo", "ggy", "gha", "gib", "gin", "glp", "gmb", "gnb", "gnq", "grc", "grd", "grl", "gtm", "guf", "gum", "guy",
    "hkg", "hmd", "hnd", "hrv", "hti", "hun", "idn", "imn", "ind", "iot", "irl", "irn", "irq", "isl", "isr", "ita",
    "jam", "jey", "jor", "jpn", "kaz", "ken", "kgz", "khm", "kir", "kna", "kor", "kwt", "lao", "lbn", "lbr", "lby",
    "lca", "lie", "lka", "lso", "ltu", "lux", "lva", "mac", "maf", "mar", "mco", "mda", "mdg", "mdv", "mex", "mhl",
    "mkd", "mli", "mlt", "mmr", "mne", "mng", "mnp", "moz", "mrt", "msr", "mtq", "mus", "mwi", "mys", "myt", "nam",
    "ncl", "ner", "nfk", "nga", "nic", "niu", "nld", "nor", "npl", "nru", "nzl", "omn", "pak", "pan", "pcn", "per",
    "phl", "plw", "png", "pol", "pri", "prk", "prt", "pry", "pse", "pyf", "qat", "reu", "rou", "rus", "rwa", "sau",
    "sdn", "sen", "sgp", "sgs", "shn", "sjm", "slb", "sle", "slv", "smr", "som", "spm", "srb", "ssd", "stp", "sur",
    "svk", "svn", "swe", "swz", "sxm", "syc", "syr", "tca", "tcd", "tgo", "tha", "tjk", "tkl", "tkm", "tls", "ton",
    "tto", "tun", "tur", "tuv", "twn", "tza", "uga", "ukr", "umi", "ury", "usa", "uzb", "vat", "vct", "ven", "vgb",
    "vir", "vnm", "vut", "wlf", "wsm", "xxk", "yem", "zaf", "zmb", "zwe"
];

// ISO 외 기존 사용 코드 (ko: 한국어, en: 영어, uk: 영국/우크라이나어)
const LEGACY_CODES = ["ko", "en", "uk"];

const COUNTRY_CODES = new Set([...ISO_ALPHA2_CODES, ...ISO_ALPHA3_CODES, ...LEGACY_CODES]);

/** 레이어 이름이 국가코드(ISO 2자리/3자리 또는 기존 코드)와 정확히 일치하는지 확인 */
export function isCountryCode(name: string): boolean {
  return COUNTRY_CODES.has(name.trim().toLowerCase());
}
