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


export function viewerStudyHint(raw) {
  const url = cleanUrl(raw);
  if (!url) return '';
  try {
    const u = new URL(url);
    const candidates = [];
    for (const key of ['studyUID','studyuid','StudyUID','study','id','share','session','stoken','token']) {
      const v = u.searchParams.get(key);
      if (v) candidates.push([key.toLowerCase(), v]);
    }
    const hash = u.hash || '';
    const qpos = hash.indexOf('?');
    if (qpos >= 0) {
      const hp = new URLSearchParams(hash.slice(qpos + 1));
      for (const key of ['studyUID','studyuid','StudyUID','study','id','share','session','stoken','token']) {
        const v = hp.get(key);
        if (v) candidates.push([key.toLowerCase(), v]);
      }
    }
    if (candidates.length) {
      const [k,v] = candidates[0];
      return `${u.origin}${u.pathname}|${k}=${v}`;
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
  if (/\/ris\/vr_?viewer(?:\/|$)/i.test(path)) return { type:'RIS_VRVIEWER', url, score:82 };
  if (/\/pages\/sharestudy\.aspx$/i.test(path) && (u.searchParams.has('stoken') || u.searchParams.has('token'))) return { type:'SHARE_STUDY', url, score:92 };
  if (path.includes('/viewer/s') && /(?:^#|\/)view\?id=/.test(hash)) return { type:'VRAD_SHELL', url, score:78 };
  const tokenKeys=['token','stoken','access_token','access-token','jwt','share','session'];
  const hasBootstrapToken=tokenKeys.some(k=>u.searchParams.has(k));
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
  if (/study(uid|instanceuid)|studyinstanceuid/.test(lower)) score += 30;
  if (/series(uid|instanceuid)|seriesinstanceuid/.test(lower)) score += 10;
  if (/token|stoken|session|share|access[_-]?key|key=|jwt|signature|sig=/.test(lower)) score += 16;
  if (/viewer|view|pacs|ohif|cornerstone|sharestudy|pportal|portal|ketqua|radiology|pmr|ris/.test(lower)) score += 14;
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
    return /(POST|CE|GAD|CONTRAST|C\+|\+C|ENH)/.test(compact) ? 'T1 sau tiêm' : 'T1';
  }
  if (/\bT2\b/.test(compact)) return 'T2';
  if (/\b(PERF|DSC|DCE|ASL)\b/.test(compact)) return 'Tưới máu';
  if (/\b(TOF|MRA|MRV|ANGIO)\b/.test(compact)) return 'Mạch máu';
  return 'Khác';
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
      name: String(firstStudy?.patientName || firstStudy?.PatientName || ''),
      id: String(firstStudy?.patientId || firstStudy?.PatientID || ''),
      studyDate: String(firstStudy?.studyDate || firstStudy?.StudyDate || ''),
      description: String(firstStudy?.studyDescription || firstStudy?.StudyDescription || '')
    }
  };
}

export function parseDicomwebSeries(payload) {
  if (!Array.isArray(payload)) return [];
  const out = [];
  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    const raw = {
      SeriesInstanceUID: dicomJsonValue(item, '0020000E'),
      SeriesNumber: dicomJsonValue(item, '00200011'),
      SeriesDescription: dicomJsonValue(item, '0008103E'),
      Modality: dicomJsonValue(item, '00080060'),
      ImageCount: dicomJsonValue(item, '00201209')
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
  if (!m) return null;
  return { rsBase: `${u.protocol}//${u.host}${m[1]}`, studyUid: decodeURIComponent(m[2]) };
}

export function bestDetectedRequest(requests, types) {
  const wanted = new Set(types);
  return (requests || []).filter(r => wanted.has(r.type)).sort((a,b) => (b.score || 0) - (a.score || 0))[0] || null;
}

export function sanitizeSegment(text, fallback='Unknown') {
  const s = String(text || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (s || fallback).slice(0, 120);
}

export function seriesFolderName(series, index=0) {
  const ordinal = String(index + 1).padStart(2, '0');
  const number = String(series?.number || '').trim();
  const description = sanitizeSegment(series?.description || series?.sequenceHint || 'Series');
  return number ? `${ordinal} - ${sanitizeSegment(number)} - ${description}` : `${ordinal} - ${description}`;
}

export function safeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-') || ['authorization','token','session','session-id','content-type','accept'].includes(lk)) out[k] = String(v);
  }
  return out;
}
