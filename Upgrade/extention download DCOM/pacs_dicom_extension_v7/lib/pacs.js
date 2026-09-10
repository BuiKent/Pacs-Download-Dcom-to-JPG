'use strict';

export const NON_IMAGE_MODALITIES = new Set([
  'SR','PR','KO','DOC','AU','SEG','REG','FID','PLAN','RTSTRUCT','RTPLAN','RTRECORD','STAND'
]);

export function cleanUrl(raw) {
  if (typeof raw !== 'string') return '';
  try {
    const u = new URL(raw);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}

export function originPattern(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return `${u.protocol}//${u.host}/*`;
  } catch { return null; }
}

export function classifyPacsUrl(raw) {
  const url = cleanUrl(raw);
  if (!url) return null;
  const lower = url.toLowerCase();
  let path = '';
  try { path = new URL(url).pathname.toLowerCase().replace(/\/+$/, ''); } catch {}

  if (/\/ClinicalStudio\/Procedures\/ProcedureComposite/i.test(path) || (/\/ClinicalStudio/i.test(path) && url.includes('ID='))) return { type:'MACH7_MANIFEST', url, score:115 };
  if (/\/ClinicalStudio\/(?:Procedures|Ajax|Chat|Worklists)\//i.test(path)) return { type:'MACH7_API', url, score:85 };
  if (/\/ClinicalStudio\/.*(?:wado|dicom|getimage|image|frame)/i.test(lower)) return { type:'MACH7_DICOM', url, score:95 };
  if (/\/ws\/ws\.asmx\/getlistimagefileinfo$/i.test(path)) return { type:'VIETMY_MANIFEST', url, score:120 };
  if (/\/ws\/getfile\.ashx$/i.test(path)) return { type:'VIETMY_DICOM', url, score:112 };
  if (/\/ws\/getimagefile\.ashx$/i.test(path)) return { type:'RENDERED_JPEG', url, score:42 };
  if (lower.includes('studydata/getstudies')) return { type:'VRAD_MANIFEST', url, score:100 };
  if (lower.includes('get-share-patient-image')) return { type:'VRPACS_MANIFEST', url, score:100 };
  if (lower.includes('study-get-public')) return { type:'VRPACS_DICOM', url, score:96 };
  if (/\/studies\/[^/]+\/series$/.test(path)) return { type:'QIDO_SERIES', url, score:110 };
  if (/\/studies\/[^/]+\/series\/[^/]+\/instances$/.test(path)) return { type:'QIDO_INSTANCES', url, score:105 };
  if (/\/studies\/[^/]+\/series\/[^/]+\/instances\/[^/]+\/metadata$/.test(path)) return { type:'DICOM_METADATA', url, score:102 };
  if (/\/studies\/[^/]+\/series\/[^/]+\/instances\/[^/]+$/.test(path)) return { type:'DICOM_INSTANCE', url, score:98 };
  if (/\/frames\/\d+(?:\/|$)/.test(path)) return { type:'DICOM_FRAME', url, score:94 };
  if (lower.includes('requesttype=wado') || /\/wado(?:\/|$|\?)/.test(lower)) return { type:'WADO', url, score:104 };
  if (lower.includes('getimagejpeg')) return { type:'RENDERED_JPEG', url, score:45 };
  if (lower.includes('getimage') || lower.includes('dicomimage') || lower.includes('dicomdata')) return { type:'DICOM_IMAGE_API', url, score:88 };
  if (/\/(?:api|rest|services?)\/.*(?:study|series|instance|dicom|image|exam|patient)/i.test(lower)) return { type:'PACS_GENERIC_API', url, score:38 };
  if (/(?:study|series|instance|dicom|pacs|viewer|image).*(?:get|list|load|fetch|query)|(?:get|list|load|fetch|query).*(?:study|series|instance|dicom|pacs|image)/i.test(lower)) return { type:'PACS_GENERIC_API', url, score:32 };
  return null;
}


function looksLikeOpaqueToken(value) {
  const v = String(value || '').trim();
  if (v.length < 16) return false;
  return /^[0-9a-f]{16,}$/i.test(v)
    || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(v)
    || /^[A-Za-z0-9_-]{16,}={0,2}$/.test(v);
}

function unnamedToken(params) {
  const rows = [...params.entries()];
  if (rows.length === 1 && rows[0][0] === '' && looksLikeOpaqueToken(rows[0][1])) return rows[0][1];
  for (const [key, value] of rows) if (!key && looksLikeOpaqueToken(value)) return value;
  return '';
}

function shortSecretHint(key, value) {
  const k = String(key || '').toLowerCase();
  const v = String(value || '');
  if (['token','stoken','session','share','access_token','access-token','jwt',''].includes(k)) {
    return `${k || 'token'}#${v.slice(-12)}`;
  }
  return `${k}=${v}`;
}

export function viewerStudyHint(raw) {
  const url = cleanUrl(raw);
  if (!url) return '';
  try {
    const u = new URL(url);
    const candidates = [];
    for (const key of ['studyUID','studyuid','StudyUID','StudyInstanceUIDs','studyinstanceuids','StudyInstanceUID','studyinstanceuid','studies','study','id','share','session','stoken','token']) {
      const v = u.searchParams.get(key);
      if (v) candidates.push([key.toLowerCase(), v]);
    }
    const unnamed = unnamedToken(u.searchParams);
    if (unnamed) candidates.push(['', unnamed]);
    const hash = u.hash || '';
    const qpos = hash.indexOf('?');
    if (qpos >= 0) {
      const hp = new URLSearchParams(hash.slice(qpos + 1));
      for (const key of ['studyUID','studyuid','StudyUID','StudyInstanceUIDs','studyinstanceuids','StudyInstanceUID','studyinstanceuid','studies','study','id','share','session','stoken','token']) {
        const v = hp.get(key);
        if (v) candidates.push([key.toLowerCase(), v]);
      }
      const hu = unnamedToken(hp);
      if (hu) candidates.push(['', hu]);
    }
    if (candidates.length) {
      const [k,v] = candidates[0];
      return `${u.origin}${u.pathname}|${shortSecretHint(k,v)}`;
    }
    return '';
  } catch { return ''; }
}

export function classifyViewerShell(raw) {
  const url = cleanUrl(raw);
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname.toLowerCase();
  const hash = (u.hash || '').toLowerCase();
  if (/\/ClinicalStudio\/Procedures\/ProcedureComposite/i.test(path) || (/\/ClinicalStudio/i.test(path) && u.searchParams.has('ID'))) return { type:'MACH7_SHELL', url, score:96 };
  if (/\/ris\/vr_?viewer(?:\/|$)/i.test(path)) return { type:'RIS_VRVIEWER', url, score:82 };
  if (/\/pages\/sharestudy\.aspx$/i.test(path) && (u.searchParams.has('stoken') || u.searchParams.has('token') || Boolean(unnamedToken(u.searchParams)))) return { type:'SHARE_STUDY', url, score:92 };
  if (path.includes('/viewer/s') && /(?:^#|\/)view\?id=/.test(hash)) return { type:'VRAD_SHELL', url, score:78 };
  if (path.includes('/viewer') && u.searchParams.has('studies')) return { type:'DICOMWEB_VIEWER', url, score:88 };
  const tokenKeys=['token','stoken','access_token','access-token','jwt','share','session'];
  const hasBootstrapToken=tokenKeys.some(k=>u.searchParams.has(k)) || Boolean(unnamedToken(u.searchParams));
  const hostPath=(u.hostname + path).toLowerCase();
  const portalHost=/(^|\.)(pportal|portal|ketqua|results?|patient|pacs|ris|radiology|rad)(\.|$)/i.test(u.hostname)
    || /hospital|benhvien|hfh|pmr|cdhaviet/i.test(u.hostname);
  if (hasBootstrapToken && /portal|pacs|viewer|image|radiology|rad|pmr|study/i.test(hostPath))
    return { type:'TOKEN_PORTAL', url, score:86 };
  if (hasBootstrapToken && u.port) return { type:'TOKEN_PORTAL', url, score:44 };
  if ((path.includes('/auth/login') || path.includes('/account/login') || path.includes('/login')) && portalHost)
    return { type:'PATIENT_PORTAL', url, score:72 };
  if (portalHost && (u.port || /share|study|exam|result|ketqua|viewer|image/i.test(path)))
    return { type:'PATIENT_PORTAL', url, score:66 };
  if ((path.includes('/viewer') || path.includes('/vrviewer')) && (u.search || u.hash)) return { type:'VIEWER_SHELL', url, score:72 };
  return null;
}

export function viewerUrlScore(raw) {
  const url = cleanUrl(raw);
  if (!url) return -1;
  const lower = url.toLowerCase();
  let score = Math.min(url.length / 80, 8);
  if (/study(uid|instanceuid)|studyinstanceuid|studies=/.test(lower)) score += 30;
  if (/series(uid|instanceuid)|seriesinstanceuid/.test(lower)) score += 10;
  if (/token|stoken|session|share|access[_-]?key|key=|jwt|signature|sig=/.test(lower)) score += 16;
  if (/viewer|view|pacs|ohif|minerva|cornerstone|sharestudy|pportal|portal|ketqua|radiology|pmr|ris/.test(lower)) score += 14;
  if (/patient(id)?=/.test(lower)) score += 4;
  try {
    const u = new URL(url);
    if (/(^|\.)(pportal|portal|ketqua|pacs|ris)(\.|$)/i.test(u.hostname)) score += 22;
    if (/hospital|benhvien|hfh|pmr|cdhaviet/i.test(u.hostname) && Boolean(u.port)) score += 14;
    if (u.pathname.length < 16 && !u.search && !/(pportal|portal|ketqua|pacs|ris)/i.test(u.hostname)) score -= 5;
  } catch {}
  return score;
}

export function sequenceHint(description) {
  const compact = String(description || '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9+]+/g, ' ');
  if (/\bADC\b/.test(compact)) return 'ADC';
  if (/\b(DWI|DIFF|TRACEW)\b/.test(compact) || compact.includes('B1000')) return 'DWI';
  if (/\b(SWI|SWAN|T2 STAR|T2STAR)\b/.test(compact)) return 'SWI';
  if (/\bFLAIR\b/.test(compact)) return 'T2 FLAIR';
  if (/\b(T1|MPRAGE|BRAVO|SPGR)\b/.test(compact)) {
    return /(POST|CE|GAD|CONTRAST|C\+|\+C|ENH)/.test(compact) ? 'T1 post-contrast' : 'T1';
  }
  if (/\bT2\b/.test(compact)) return 'T2';
  if (/\b(PERF|DSC|DCE|ASL)\b/.test(compact)) return 'Perfusion';
  if (/\b(TOF|MRA|MRV|ANGIO)\b/.test(compact)) return 'Angiography';
  return 'Other';
}

function firstValue(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return v;
  }
  return '';
}

export function normalizeSeries(raw, source, index) {
  const uid = String(firstValue(raw, ['SeriesInsUID','SeriesInstanceUID','seriesInstanceUID','seriesUid','seriesUID','seriesId','id']) || '').trim();
  const number = String(firstValue(raw, ['SeriesNumber','SeriesNo','SeriesNum','seriesNumber','seriesNo']) || '').trim();
  const description = String(firstValue(raw, ['SeriesDescription','SeriesDesc','Description','seriesDescription','description','seriesName','name','ProtocolName','protocolName']) || '').trim() || `Series ${number || index + 1}`;
  const modality = String(firstValue(raw, ['Modality','modality','modalityDicom']) || '').trim().toUpperCase();
  let count = firstValue(raw, ['ImageCount','imageCount','numberOfImages','instanceCount','NumberOfImages']);
  if (!count && Array.isArray(raw?.imageIds)) count = raw.imageIds.length;
  const imageCount = Math.max(0, Number.parseInt(count || 0, 10) || 0);
  return { id: uid || `${source}:${index}`, seriesUid: uid, number, description, modality, imageCount, sequenceHint: sequenceHint(description), source };
}

export function dicomJsonValue(item, tag) {
  const values = item?.[tag]?.Value;
  return Array.isArray(values) && values.length ? values[0] : '';
}

export function parseVradManifest(payload) {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload.data ?? payload) : payload;
  const study = Array.isArray(data) ? (data[0] || {}) : (data || {});
  const rawSeries = Array.isArray(study?.SeriesList) ? study.SeriesList : [];
  return {
    study,
    series: rawSeries.map((s, i) => normalizeSeries(s, 'vrad', i)),
    rawSeries,
    patient: {
      name: String(study?.PatientName || study?.PatName || study?.Patient?.Name || ''),
      id: String(study?.PatientID || study?.PatID || study?.PatientId || ''),
      studyDate: String(study?.StudyDate || study?.StuDate || ''),
      description: String(study?.StudyDescription || study?.Description || '')
    }
  };
}

export function parseVrpacsManifest(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const studies = Array.isArray(data.studyList) ? data.studyList : [];
  const rawSeries = [];
  for (const st of studies) for (const se of (st?.seriesList || [])) rawSeries.push({ ...se, __study: st });
  const firstStudy = studies[0] || {};
  return {
    studies,
    rawSeries,
    series: rawSeries.map((s, i) => normalizeSeries(s, 'vrpacs', i)),
    patient: {
      name: String(firstStudy?.patientName || firstStudy?.PatientName || data?.pName || data?.patientName || ''),
      id: String(firstStudy?.patientId || firstStudy?.PatientID || data?.pCode || data?.pID || data?.patientId || ''),
      studyDate: String(firstStudy?.studyDate || firstStudy?.StudyDate || ''),
      description: String(firstStudy?.studyDescription || firstStudy?.StudyDescription || '')
    }
  };
}

export function parseDicomwebSeries(payload) {
  const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.seriesList) ? payload.seriesList : []));
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const raw = {
      SeriesInstanceUID: dicomJsonValue(item, '0020000E') || item?.SeriesInstanceUID || item?.seriesInstanceUID || item?.seriesUid,
      SeriesNumber: dicomJsonValue(item, '00200011') || item?.SeriesNumber || item?.seriesNumber || item?.seriesNo,
      SeriesDescription: dicomJsonValue(item, '0008103E') || item?.SeriesDescription || item?.seriesDescription || item?.description,
      Modality: dicomJsonValue(item, '00080060') || item?.Modality || item?.modality,
      ImageCount: dicomJsonValue(item, '00201209') || item?.ImageCount || item?.imageCount || item?.numberOfFrames
    };
    if (raw.SeriesInstanceUID && !NON_IMAGE_MODALITIES.has(String(raw.Modality || '').toUpperCase())) out.push(normalizeSeries(raw, 'dicomweb', i));
  }
  return out;
}

export function deriveDicomweb(rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return null;
  const u = new URL(url);
  const m = u.pathname.match(/^(.*)\/studies\/([^/]+)(?:\/.*)?$/i);
  if (m) {
    return { rsBase: `${u.protocol}//${u.host}${m[1]}`, studyUid: decodeURIComponent(m[2]) };
  }
  for (const key of ['StudyInstanceUIDs','studyInstanceUIDs','StudyInstanceUID','studyInstanceUID','studyUID','studyuid','studies','study']) {
    const v = u.searchParams.get(key);
    if (v && /^\d+(\.\d+)+$/.test(v.trim())) {
      let rsBase = `${u.protocol}//${u.host}`;
      if (u.pathname.includes('/dicom-web') || u.pathname.includes('/dicomweb') || u.pathname.includes('/rs')) {
        const sub = u.pathname.match(/^(.*?\/(?:dicom-web|dicomweb|rs|wado-rs))/i);
        if (sub) rsBase = `${u.protocol}//${u.host}${sub[1]}`;
      }
      return { rsBase, studyUid: v.trim() };
    }
  }
  return null;
}

export function bestDetectedRequest(requests, types) {
  const wanted = new Set(types);
  return (requests || []).filter(r => wanted.has(r.type)).sort((a,b) => (b.score || 0) - (a.score || 0))[0] || null;
}

/**
 * Mirror of the app's `_safe_name`: a run of illegal characters collapses into
 * ONE underscore (not one each), whitespace collapses, and the result is capped
 * at 80 characters. Keep the two in step — see PATIENT_FOLDER_NAME_MAX.
 */
export function sanitizeSegment(text, fallback='Unknown') {
  const s = String(text || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (s || fallback).slice(0, 80);
}

/** Strip the leading/trailing dots and spaces Windows silently drops. */
export function trimSegmentEdges(text) {
  return String(text || '').replace(/^[. ]+/, '').replace(/[. ]+$/, '');
}

export function seriesFolderName(series, index=0) {
  const ordinal = String(index + 1).padStart(2, '0');
  const number = String(series?.number || '').trim();
  const description = sanitizeSegment(series?.description || series?.sequenceHint || 'Series');
  return number ? `${ordinal} - ${sanitizeSegment(number)} - ${description}` : `${ordinal} - ${description}`;
}

export function formatDmyDate(raw, fallback = 'KHONG_RO_NGAY') {
  if (!raw) return fallback;
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length === 8) {
    const y1 = parseInt(digits.slice(0, 4), 10);
    const m1 = parseInt(digits.slice(4, 6), 10);
    const d1 = parseInt(digits.slice(6, 8), 10);
    if (y1 >= 1900 && y1 <= 2100 && m1 >= 1 && m1 <= 12 && d1 >= 1 && d1 <= 31) {
      return `${digits.slice(6, 8)}-${digits.slice(4, 6)}-${digits.slice(0, 4)}`;
    }
    const d2 = parseInt(digits.slice(0, 2), 10);
    const m2 = parseInt(digits.slice(2, 4), 10);
    const y2 = parseInt(digits.slice(4, 8), 10);
    if (y2 >= 1900 && y2 <= 2100 && m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}`;
    }
  }
  const mIso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (mIso) {
    return `${mIso[3].padStart(2, '0')}-${mIso[2].padStart(2, '0')}-${mIso[1]}`;
  }
  const mDmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (mDmy) {
    return `${mDmy[1].padStart(2, '0')}-${mDmy[2].padStart(2, '0')}-${mDmy[3]}`;
  }
  return sanitizeSegment(str, fallback);
}

/**
 * Parse a date the way the app's `_parse_date_flexible` does, so both tools
 * read the same tag identically. Returns a UTC Date or null.
 */
export function parseDateFlexible(value) {
  if (!value) return null;
  const text = String(value).trim();
  const build = (y, m, d) => {
    if (!(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    // Reject overflow such as 31-02: Date would roll it into the next month.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  };
  let m;
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return build(+m[1], +m[2], +m[3]);
  if ((m = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/))) return build(+m[3], +m[2], +m[1]);
  if ((m = text.match(/^(\d{4})(\d{2})(\d{2})/))) return build(+m[1], +m[2], +m[3]);
  if ((m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return build(+m[3], +m[2], +m[1]);
  if ((m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/))) return build(+m[1], +m[2], +m[3]);
  return null;
}

/**
 * Age label derived from two dates — the mirror of the app's `_age_from_dates`.
 * Returns '' when the dates cannot carry an answer.
 */
export function ageFromDates(birthDate, referenceDate) {
  const birth = parseDateFlexible(birthDate);
  const ref = parseDateFlexible(referenceDate);
  if (!birth || !ref || ref < birth) return '';
  const bY = birth.getUTCFullYear(), bM = birth.getUTCMonth() + 1, bD = birth.getUTCDate();
  const rY = ref.getUTCFullYear(), rM = ref.getUTCMonth() + 1, rD = ref.getUTCDate();
  let years = rY - bY - ((rM < bM || (rM === bM && rD < bD)) ? 1 : 0);
  if (years > 0) return `${years}T`;
  let months = (rY - bY) * 12 + rM - bM - (rD < bD ? 1 : 0);
  if (months > 0) return `${months} tháng`;
  return `${Math.round((ref - birth) / 86400000)} ngày`;
}

/**
 * Patient age exactly as the app's `_normalise_patient_age` writes it: the two
 * dates win when they can answer, otherwise the DICOM `AS` tag ("045Y").
 * The reference date is the download date, matching the folder's own suffix.
 */
/** A bare `1999` means that year — RIS pages often carry only a birth year. */
export function expandYearOnlyDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}$/.test(text) && +text >= 1900 && +text <= 2100) return `${text}0101`;
  return value;
}

export function computePatientAge(birthDate, referenceDate, declaredAge) {
  const derived = ageFromDates(expandYearOnlyDate(birthDate), referenceDate);
  if (derived) return derived;
  const raw = String(declaredAge || '').trim().toUpperCase();
  // An age already formatted by either tool, fed back in: keep it rather than
  // downgrading a known age to "KHONG_RO_TUOI" on a second pass.
  let already = raw.match(/^(\d+)\s*T$/);
  if (already) return `${parseInt(already[1], 10)}T`;
  already = raw.match(/^(\d+)\s*(THÁNG|TUẦN|NGÀY)$/);
  if (already) {
    const unit = {'THÁNG': 'tháng', 'TUẦN': 'tuần', 'NGÀY': 'ngày'}[already[2]];
    return `${parseInt(already[1], 10)} ${unit}`;
  }
  const m = raw.match(/^(\d{3})([DWMY])$/);
  if (m) {
    const value = parseInt(m[1], 10);
    const unit = m[2];
    if (value > 0) {
      if (unit === 'Y') return `${value}T`;
      if (unit === 'M') return `${value} tháng`;
      if (unit === 'W') return `${value} tuần`;
      if (unit === 'D') return `${value} ngày`;
    }
    return {Y: '0T', M: '0 tháng', W: '0 tuần', D: '0 ngày'}[unit];
  }
  return 'KHONG_RO_TUOI';
}

// Field widths shared with the app (`dcom_pipeline.PATIENT_FOLDER_NAME_MAX` and
// friends). Both tools build the same folder pair, and a name differing by one
// character files the same patient twice. `tests/test_folder_name_parity.py`
// fails if these drift apart.
export const PATIENT_FOLDER_NAME_MAX = 40;
export const STUDY_FOLDER_MODALITY_MAX = 12;
export const STUDY_FOLDER_DESC_MAX = 40;

export function buildPatientFolderName(info = {}) {
  const name = trimSegmentEdges(sanitizeSegment(
    String(info.patientName || info.name || '').replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim(),
    'KHONG_RO_TEN'
  ).slice(0, PATIENT_FOLDER_NAME_MAX)) || 'KHONG_RO_TEN';
  const id = trimSegmentEdges(
    sanitizeSegment(info.patientId || info.id || 'KHONG_RO_ID', 'KHONG_RO_ID')
  ) || 'KHONG_RO_ID';

  let downloadDate = info.downloadDate;
  if (!downloadDate) {
    const now = new Date();
    downloadDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  } else {
    downloadDate = formatDmyDate(downloadDate);
  }
  // Age is measured at the download date, which is the very date this folder
  // name ends with — the app does the same.
  const age = trimSegmentEdges(computePatientAge(
    info.birthDate || info.patientBirthDate,
    downloadDate,
    info.age || info.patientAge
  )) || 'KHONG_RO_TUOI';
  return `${id} - ${name} - ${age} - ${downloadDate}`;
}

export function buildStudyFolderName(info = {}) {
  const date = formatDmyDate(info.studyDate, 'KHONG_RO_NGAY');
  let modality = trimSegmentEdges(sanitizeSegment(
    String(info.modality || '').trim().toUpperCase(), ''
  ).slice(0, STUDY_FOLDER_MODALITY_MAX));
  if (!modality) modality = 'UNKNOWN';
  const desc = trimSegmentEdges(sanitizeSegment(
    String(info.description || info.studyDescription || info.desc || '').trim(),
    'KHONG_RO_MO_TA'
  ).slice(0, STUDY_FOLDER_DESC_MAX)) || 'KHONG_RO_MO_TA';
  return trimSegmentEdges(`${date} - ${modality} - ${desc}`);
}

// Mirror of `dcom_pipeline.sanitize_viewer_url`. The sidecar we leave beside a
// study ends up on the reader's disk, so it must never carry the credential the
// viewer handed us — while still keeping a share link whose token IS the only
// thing identifying the study, or "Tải tiếp" would have nothing to reopen.
const STUDY_LOCATOR_QUERY_KEYS = new Set([
  'studyinstanceuids', 'studyinstanceuid', 'study_uid', 'studyuid', 'study', 'studyid', 'siuid',
  'accessionnumber', 'accession', 'accession_no', 'acc',
  'patientid', 'patient_id', 'pid',
  'seriesinstanceuids', 'seriesinstanceuid', 'seriesuid', 'series', 'seriesid',
]);
const SENSITIVE_URL_PARAMS = new Set([
  'token', 'access_token', 'auth', 'signature', 'sig',
  'key', 'apikey', 'api_key', 'secret', 'password', 'pass', 'pwd',
  'session', 'sessionid', 'session_id', 'bearer',
  'x-amz-signature', 'x-amz-security-token', 'x-amz-credential', 'x-amz-date',
]);
const ALWAYS_SENSITIVE_PARAMS = new Set([
  'password', 'pass', 'pwd', 'secret', 'bearer',
  'x-amz-signature', 'x-amz-security-token', 'x-amz-credential', 'x-amz-date',
]);

export function sanitizeViewerUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const rawQuery = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
    const rawFragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const hasQuery = Boolean(rawQuery);
    const hasFragQuery = rawFragment.includes('?');
    if (!hasQuery && !hasFragQuery) return url;

    const queryPairs = hasQuery ? [...new URLSearchParams(rawQuery)] : [];
    let fragPath = rawFragment, fragPairs = [];
    if (hasFragQuery) {
      const cut = rawFragment.indexOf('?');
      fragPath = rawFragment.slice(0, cut);
      fragPairs = [...new URLSearchParams(rawFragment.slice(cut + 1))];
    }

    const allKeys = new Set([...queryPairs, ...fragPairs].map(([k]) => k.trim().toLowerCase()));
    const hasStudyLocator = [...allKeys].some(k => STUDY_LOCATOR_QUERY_KEYS.has(k));

    const shouldStrip = (key) => {
      const kn = String(key).trim().toLowerCase();
      if (ALWAYS_SENSITIVE_PARAMS.has(kn)) return true;
      if (['signature', 'secret', 'password'].some(s => kn.includes(s))) return true;
      if (hasStudyLocator) {
        if (SENSITIVE_URL_PARAMS.has(kn) || kn.includes('token') || kn.includes('session')) return true;
      }
      return false;
    };
    const encode = (pairs) => {
      const sp = new URLSearchParams();
      for (const [k, v] of pairs) if (!shouldStrip(k)) sp.append(k, v);
      return sp.toString();
    };

    parsed.search = encode(queryPairs);
    if (hasFragQuery) {
      const cleanedFrag = encode(fragPairs);
      parsed.hash = cleanedFrag ? `${fragPath}?${cleanedFrag}` : fragPath;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export const STUDY_LOCK_NAME = '.dcom-busy.json';
export const STUDY_LOCK_FORMAT = 'dcom-study-lock-v1';
/** Renew well inside the app's 300s expiry so a live download never lapses. */
export const STUDY_LOCK_RENEW_MS = 60000;

/**
 * The claim this extension leaves in a study folder while it fills it.
 *
 * The desktop app can be pointed at the same study and cannot see this
 * process — the folder is all they share. Without the claim the app reads a
 * study still arriving as one that failed halfway, and offers to download it
 * again over the top.
 *
 * `renewedAt` is seconds, matching `dcom_pipeline.read_study_lock`, and is
 * rewritten as the job runs so a long study does not lapse. A browser killed
 * mid download simply stops renewing, and the claim expires on its own.
 */
export function buildStudyLock({owner = 'extension', label = '', claimId = '', now = Date.now()} = {}) {
  return {
    format: STUDY_LOCK_FORMAT,
    owner: String(owner || 'extension'),
    label: String(label || ''),
    // Whoever took the claim. Only they may renew or release it: without this a
    // second job clears the first one's claim on its way past, and the
    // exclusion it exists to provide quietly stops applying.
    claimId: String(claimId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
    renewedAt: Math.floor(Number(now) / 1000),
  };
}

/** True when a claim read off disk is live and belongs to someone else. */
export function claimBlocksUs(claim, ourClaimId, ttlSeconds = 300, now = Date.now()) {
  if (!claim || claim.format !== STUDY_LOCK_FORMAT) return false;
  const renewed = Number(claim.renewedAt) || 0;
  if (renewed <= 0) return false;
  if (Math.floor(now / 1000) - renewed > ttlSeconds) return false;
  return String(claim.claimId || '') !== String(ourClaimId || '');
}

export const SIDECAR_FORMAT = 'dcom-extension-source-v1';

/**
 * The `dcom-source.json` left beside a study this extension downloaded.
 *
 * It records ONLY what the DICOM tags cannot carry — the viewer link, with its
 * credentials stripped. Patient identity stays with the tags, which remain the
 * single source of truth, so a stale sidecar can never rename a patient.
 *
 * `status` is what lets the app tell a finished study from one whose download
 * stopped part-way. The file is written as soon as the first image lands, not
 * only at the end: a browser closed mid-download used to leave images with no
 * link beside them, and "Tải tiếp" needs the link precisely then.
 */
/**
 * Job outcomes the app must not read as a finished study.
 *
 * Anything other than a clean `done` leaves images missing, so the sidecar has
 * to carry the outcome rather than the fact that SOME images arrived.
 */
const INCOMPLETE_JOB_STATUS = new Set(['downloading', 'partial', 'cancelled', 'error', 'done_with_errors']);

export function sidecarStatusFor(jobStatus) {
  const value = String(jobStatus || '').trim();
  if (!value) return 'complete';
  return INCOMPLETE_JOB_STATUS.has(value) ? (value === 'done_with_errors' ? 'partial' : value) : 'complete';
}

export function buildStudySidecar({
  sourceUrl, studyUid, info = {}, imageCount = 0, plannedTotal = 0,
  failedCount = 0, status = 'complete', now = new Date(),
} = {}) {
  const clean = sanitizeViewerUrl(String(sourceUrl || ''));
  // `sanitizeViewerUrl` hands back whatever it cannot parse. A sidecar carrying
  // something that is not a link is worse than no sidecar: the app would offer
  // "Tải tiếp" on a study it cannot reopen.
  let usable = false;
  try {
    usable = /^https?:$/.test(new URL(clean).protocol);
  } catch { usable = false; }
  if (!usable) return null;
  const stamp = (now instanceof Date ? now : new Date()).toISOString();
  const saved = Math.max(0, Number(imageCount) || 0);
  return {
    format: SIDECAR_FORMAT,
    sourceUrl: clean,
    studyInstanceUid: String(studyUid || ''),
    patientId: String(info.patientId || ''),
    studyDate: String(info.studyDate || ''),
    modality: String(info.modality || ''),
    // How many images actually reached the disk.
    imageCount: saved,
    // How many the job set out to fetch. The app compares the files it finds
    // against THIS, never against `imageCount`: comparing what was saved to
    // what was saved is a tautology that reported every failed download as
    // complete.
    plannedTotal: Math.max(saved, Number(plannedTotal) || 0),
    failedCount: Math.max(0, Number(failedCount) || 0),
    // 'complete' only for a job that finished cleanly. Everything else names
    // what went wrong so the app can offer to finish it.
    status: sidecarStatusFor(status),
    downloadedAt: stamp,
  };
}

/** The study folder a sidecar belongs in: `studyFolder` ends in `/DICOM`. */
export function sidecarStudyPath(studyFolder) {
  return String(studyFolder || '').replace(/\/+DICOM\/*$/i, '');
}

export function buildStudyStoragePath(info = {}) {
  const patientFolder = buildPatientFolderName(info);
  const studyFolder = buildStudyFolderName(info);
  return `${patientFolder}/${studyFolder}/DICOM`;
}


/**
 * GE Centricity Universal Viewer (ZFP) streams pixel data via WebSocket `image-provider`
 * accompanied by private JSON metadata. This helper converts that structure to DICOM+JSON
 * for `buildPart10FromFrames()` to reconstruct Part-10 files.
 */
export function zfpMetaToDicomJson(meta, sopRow, group, study) {
  const out = {};
  meta = meta || {}; sopRow = sopRow || {}; group = group || {}; study = study || {};
  const put = (tag, vr, value) => {
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && !value.length)) return;
    out[tag] = {vr, Value: Array.isArray(value) ? value : [value]};
  };
  // ZFP times include colons ("17:29:45"), which are stripped for VR TM.
  const tm = v => String(v || '').replace(/[^0-9.]/g, '').slice(0, 16);
  const da = v => String(v || '').replace(/[^0-9]/g, '').slice(0, 8);
  const num = v => (v === undefined || v === null || v === '') ? null : Number(v);

  const demo = study.patientDemographics || {};
  const name = ((demo.patientName || {}).personNameString || '').trim();
  put('00100010', 'PN', name ? {Alphabetic: name} : null);
  put('00100020', 'LO', demo.patientId);
  put('00100040', 'CS', demo.patientSex);
  put('00100030', 'DA', da(demo.patientBirthDate));
  put('00080050', 'SH', demo.accessionNumber);

  const dt = String(study.studyDateTime || '');
  put('00080020', 'DA', da(dt.split(' ')[0]));
  put('00080030', 'TM', tm(dt.split(' ')[1]));
  put('00081030', 'LO', (study.mappedStudyDescription || {})[group.studyInstanceUid]);

  put('00080016', 'UI', meta.sopClassUid);
  put('00080018', 'UI', meta.sopInstanceUid);
  put('0020000D', 'UI', group.studyInstanceUid);
  put('0020000E', 'UI', meta.seriesInstanceUid || sopRow.seriesInstanceUid);
  put('0008103E', 'LO', group.description);
  put('00080060', 'CS', (group.modalities || [])[0]);
  put('00200013', 'IS', String(meta.instanceNumber ?? sopRow.instanceNumber ?? ''));
  put('00080021', 'DA', da(meta.imageDate));
  put('00080031', 'TM', tm(meta.imageTime));
  put('00080070', 'LO', meta.manufacturer);
  put('00081090', 'LO', meta.manufacturerModelName);
  put('00080080', 'LO', meta.institutionName);
  put('00081010', 'SH', meta.stationName);
  put('00080008', 'CS', meta.imageType);

  const dim = meta.dimensions || {};
  put('00280010', 'US', num(dim.rows));
  put('00280011', 'US', num(dim.columns));
  put('00280100', 'US', num(meta.bitsAllocated));
  put('00280101', 'US', num(meta.bitsStored ?? meta.bitsAllocated));
  let high = meta.highBit;
  if ((high === undefined || high === null) && meta.bitsStored) high = Number(meta.bitsStored) - 1;
  put('00280102', 'US', num(high));
  put('00280103', 'US', num(meta.pixelRepresentation ?? 0));
  put('00280002', 'US', num(meta.samplesPerPixel ?? 1));
  put('00280004', 'CS', meta.photometricInterpretation || 'MONOCHROME2');
  if (Number(meta.numberOfFrames || 1) > 1) put('00280008', 'IS', String(meta.numberOfFrames));

  const wl = meta.windowLevel || {};
  if (wl.windowWidth) {
    put('00281050', 'DS', String(wl.windowCenter));
    put('00281051', 'DS', String(wl.windowWidth));
  }
  const rs = meta.rescaleInfo || {};
  if (rs && (rs.intercept !== undefined || rs.slope !== undefined)) {
    put('00281052', 'DS', String(rs.intercept ?? 0));
    put('00281053', 'DS', String(rs.slope ?? 1));
  }

  const sp = sopRow.pixelSpacing || {};
  if (sp.physicalDeltaY && sp.physicalDeltaX) {
    put('00280030', 'DS', [String(sp.physicalDeltaY), String(sp.physicalDeltaX)]);
  }
  if (sopRow.imagePosition) put('00200032', 'DS', String(sopRow.imagePosition).split('\\').filter(Boolean));
  const io = sopRow.imageOrientation;
  if (io) put('00200037', 'DS', ['rowX','rowY','rowZ','columnX','columnY','columnZ'].map(k => String(io[k] ?? 0)));
  if (sopRow.sliceLocation !== undefined && sopRow.sliceLocation !== null && sopRow.sliceLocation !== '') {
    put('00201041', 'DS', String(sopRow.sliceLocation));
  }
  return out;
}

export function zfpSeriesChoices(groups) {
  return (groups || []).map((group, index) => {
    const sops = group.dicomSops || [];
    // Use actual SeriesInstanceUID as key to prevent distinct series with identical names from colliding.
    return normalizeSeries({
      SeriesInstanceUID: (sops[0] || {}).seriesInstanceUid || group.groupId,
      SeriesDescription: group.description,
      SeriesNumber: group.groupDisplayId,
      Modality: (group.modalities || [])[0],
      ImageCount: sops.length,
    }, 'zfp', index);
  });
}

export function bodyLooksJson(body) {
  if (!body) return false;
  try {
    const s = (typeof body === 'string' ? body : new TextDecoder().decode(body)).trim();
    return (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'));
  } catch { return false; }
}

/**
 * Content-Type used when replaying recorded manifest requests.
 */
export function replayContentType(state, url, requestMeta, body) {
  if (requestMeta?.contentType) return String(requestMeta.contentType);
  if (bodyLooksJson(body)) return 'application/json; charset=UTF-8';
  try {
    const raw = state?.headersByOrigin?.[new URL(url).origin] || {};
    for (const [k, v] of Object.entries(raw)) if (k.toLowerCase() === 'content-type' && v) return String(v);
  } catch {}
  return '';
}

export function safeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-') || ['authorization','token','session','session-id','content-type','accept'].includes(lk)) out[k] = String(v);
  }
  return out;
}

export function computeUrlFingerprint(url, adapterName = '') {
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`.toLowerCase();
    let path = u.pathname;
    path = path.replace(/\b\d+(\.\d+)+\b/g, '*');
    path = path.replace(/[0-9a-fA-F\-]{8,}/g, '*');
    path = path.replace(/\/\d+(?=\/|$)/g, '/*');
    const queryKeys = new Set([...u.searchParams.keys()].filter(Boolean));
    const hash = u.hash || '';
    const qpos = hash.indexOf('?');
    if (qpos >= 0) {
      const hp = new URLSearchParams(hash.slice(qpos + 1));
      for (const k of hp.keys()) if (k) queryKeys.add(k);
    }
    const sortedKeys = [...queryKeys].sort().join(',');
    const adapterToken = adapterName ? String(adapterName).toUpperCase() : '*';
    return `${origin}|${path}?${sortedKeys}|${adapterToken}`;
  } catch {
    return `generic|*|${adapterName ? String(adapterName).toUpperCase() : '*'}`;
  }
}

export class RecipeStoreV2 {
  static SCHEMA_VERSION = 2;
  static TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (7,776,000,000 ms)
  static MAX_RECIPES = 200;

  static purgeExpired(recipes = {}, now = Date.now()) {
    const valid = {};
    if (!recipes || typeof recipes !== 'object') return valid;
    for (const [k, v] of Object.entries(recipes)) {
      if (!v || typeof v !== 'object') continue;
      const lastAct = v.lastSuccessAt || v.updatedAt || 0;
      let hasRecentAdapter = false;
      if (v.adapters && typeof v.adapters === 'object') {
        for (const ad of Object.values(v.adapters)) {
          if (ad && typeof ad === 'object' && ad.lastSuccessAt && (now - ad.lastSuccessAt < RecipeStoreV2.TTL_MS)) {
            hasRecentAdapter = true;
            break;
          }
        }
      }
      if ((now - lastAct < RecipeStoreV2.TTL_MS) || hasRecentAdapter) {
        valid[k] = v;
      }
    }
    return valid;
  }

  static pruneCapacity(recipes = {}, maxEntries = RecipeStoreV2.MAX_RECIPES) {
    const entries = Object.entries(recipes);
    if (entries.length <= maxEntries) return recipes;
    entries.sort((a, b) => {
      const timeA = a[1]?.lastSuccessAt || a[1]?.updatedAt || 0;
      const timeB = b[1]?.lastSuccessAt || b[1]?.updatedAt || 0;
      return timeB - timeA;
    });
    return Object.fromEntries(entries.slice(0, maxEntries));
  }

  static createRecipe(fingerprint = '', adapter = '', now = Date.now()) {
    return {
      schemaVersion: RecipeStoreV2.SCHEMA_VERSION,
      fingerprint,
      adapter: String(adapter || ''),
      preferredRoutes: [],
      success: 0,
      partial: 0,
      failure: 0,
      failureByClass: { timeout: 0, auth: 0, server: 0, invalidDicom: 0, other: 0 },
      latencyEwmaMs: 0,
      lastSuccessAt: 0,
      lastFailureClass: '',
      updatedAt: now,
    };
  }

  static updateRecipe(existing, adapter, outcome = {}, now = Date.now()) {
    const r = existing ? { ...existing } : RecipeStoreV2.createRecipe('', adapter, now);
    if (adapter) r.adapter = adapter;
    r.schemaVersion = RecipeStoreV2.SCHEMA_VERSION;
    r.updatedAt = now;

    const status = String(outcome.status || '').toLowerCase();
    if (['done', 'complete'].includes(status)) {
      r.success = (r.success || 0) + 1;
      r.lastSuccessAt = now;
      if (Array.isArray(outcome.preferredRoutes) && outcome.preferredRoutes.length) {
        r.preferredRoutes = [...outcome.preferredRoutes];
      }
      if (outcome.latencyMs > 0) {
        const oldEwma = r.latencyEwmaMs || outcome.latencyMs;
        r.latencyEwmaMs = Math.round(0.7 * oldEwma + 0.3 * outcome.latencyMs);
      }
    } else if (status === 'partial') {
      r.partial = (r.partial || 0) + 1;
    } else if (['error', 'failed', 'done_with_errors'].includes(status)) {
      r.failure = (r.failure || 0) + 1;
      const errClass = outcome.errorClass || outcome.failureClass || 'other';
      r.lastFailureClass = errClass;
      if (!r.failureByClass) r.failureByClass = { timeout: 0, auth: 0, server: 0, invalidDicom: 0, other: 0 };
      r.failureByClass[errClass] = (r.failureByClass[errClass] || 0) + 1;
    }
    return r;
  }

  static getPreferredAdapter(recipe) {
    if (!recipe) return null;
    if ((recipe.success || 0) > (recipe.failure || 0) && recipe.adapter) {
      return recipe.adapter;
    }
    return null;
  }

  static getPreferredRoutes(recipe) {
    if (recipe && Array.isArray(recipe.preferredRoutes)) {
      return recipe.preferredRoutes;
    }
    return [];
  }
}

/** Attach/override query parameters while preserving existing session parameters. */
export function withQueryParams(rawUrl, params = {}) {
  try {
    const u = new URL(rawUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Read full QIDO-RS query with automatic offset pagination.
 *
 * PS3.18 8.3.4: Server is permitted to return fewer results than the requested limit.
 */
export async function fetchQidoPaged(fetchJson, url, {
  accept = 'application/dicom+json, application/json',
  pageSize = 500,
  maxPages = 400,
  keyOf = null,
} = {}) {
  const out = [], seen = new Set();
  for (let page = 0, offset = 0; page < maxPages; page++) {
    const batch = await fetchJson(withQueryParams(url, { limit: pageSize, offset }), accept);
    const rows = Array.isArray(batch) ? batch : (batch && typeof batch === 'object' ? [batch] : []);
    if (!rows.length) break;
    let added = 0;
    for (const row of rows) {
      const key = keyOf ? keyOf(row) : null;
      if (key) { if (seen.has(key)) continue; seen.add(key); }
      out.push(row); added++;
    }
    if (!added) break;
    offset += rows.length;
  }
  return out;
}
