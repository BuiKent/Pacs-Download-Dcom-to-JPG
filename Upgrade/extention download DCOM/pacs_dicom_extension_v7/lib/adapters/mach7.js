'use strict';
import { normalizeSeries, seriesFolderName, sanitizeSegment, bestDetectedRequest } from '../pacs.js';
import { groupGenericEntries } from '../generic_discovery.js';

const uid = v => { const s = String(v || '').trim(); return /^\d+(?:\.\d+)+$/.test(s) ? s : ''; };
const DECLARED_ALIAS = { patientBirthDate: 'birthDate', accessionNumber: 'accession' };
const metaField = (entry, name) => String(
  entry?.meta?.[name] || entry?.declared?.[name] || entry?.declared?.[DECLARED_ALIAS[name] || name] || ''
).trim();

function entriesFromState(state) {
  const entries = Array.isArray(state?.genericEntries) ? state.genericEntries.filter(x => x?.url) : [];
  if (entries.length) return entries;
  return [...new Set(state?.genericDirectUrls || [])].map(url => ({
    url, method: 'GET', requestBody: null, contentType: '', declared: {}, meta: null, source: 'mach7'
  }));
}

export const Mach7Adapter = {
  id: 'MACH7',
  match(summary, state) {
    const urls = [summary?.currentUrl, summary?.bestViewerUrl, ...(summary?.frameUrls || []), ...(summary?.navUrls || [])].filter(Boolean);
    const hasMach7Url = urls.some(u => /ClinicalStudio|ProcedureComposite|Diagnostic\s*Studio|benhviencuadong\.vn/i.test(u));
    const hasMach7Request = Boolean(bestDetectedRequest(summary?.requests || [], ['MACH7_MANIFEST', 'MACH7_SHELL', 'MACH7_API', 'MACH7_DICOM']));
    const hasMach7Dom = Boolean(state?.domPatient?.isMach7 || (state?.pageHintReasons || []).includes('mach7'));
    return (hasMach7Url || hasMach7Request || hasMach7Dom) && (entriesFromState(state).length > 0 || Boolean(state?.domPatient));
  },
  async analyze(ctx) {
    const entries = entriesFromState(ctx.state);
    const p = ctx.state.genericProfile || {};
    const dom = ctx.state.domPatient || {};

    const groups = entries.length ? groupGenericEntries(entries) : [];
    const domSeriesList = Array.isArray(ctx.state.domSeries) ? ctx.state.domSeries : [];
    
    // Assign numbers to captured groups if missing
    groups.forEach((g, i) => {
      if (!g.number) {
        g.number = domSeriesList[i]?.number || String(i + 1);
      }
    });

    // Merge DOM-discovered series with network-captured groups
    for (let i = 0; i < domSeriesList.length; i++) {
      const ds = domSeriesList[i];
      const existing = groups.find(g => (String(g.number) === String(ds.number)) || (ds.uid && g.seriesUid === ds.uid));
      if (existing) {
        if (!existing.description || existing.description.startsWith('Series ')) {
          if (ds.description) existing.description = ds.description;
        }
        if (ds.imageCount && !existing.entries?.length) {
          existing.imageCount = ds.imageCount;
        }
      } else {
        groups.push({
          seriesUid: ds.uid || `mach7.series.${ds.number || (groups.length + 1)}`,
          number: ds.number || String(groups.length + 1),
          description: ds.description || `Series ${ds.number || (groups.length + 1)}`,
          modality: ds.modality || dom.modality || 'MR',
          imageCount: ds.imageCount || 0,
          entries: []
        });
      }
    }

    // Sort groups by series number
    groups.sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));

    const series = groups.map((g, i) => normalizeSeries({
      SeriesInstanceUID: g.seriesUid || `mach7.series.${g.number || (i + 1)}`,
      SeriesNumber: g.number || String(i + 1),
      SeriesDescription: g.description || `Series ${g.number || (i + 1)}`,
      Modality: g.modality || dom.modality || 'MR',
      ImageCount: g.entries?.length || g.imageCount || 0
    }, 'mach7', i));
    groups.forEach((g, i) => { g.choice = series[i]; });

    const first = entries.find(x => x.meta) || {};
    const study = uid(p.studyUid) || uid(metaField(first, 'studyUid')) || uid(dom.studyUid) || `mach7.${dom.patientId || 'study'}.${(dom.studyDate || '').replace(/[^0-9]/g, '') || Date.now()}`;

    const patName = dom.patientName || p.patientName || metaField(first, 'patientName') || '';
    const patId = dom.patientId || p.patientId || metaField(first, 'patientId') || '';
    const bDate = dom.patientBirthDate || p.patientBirthDate || metaField(first, 'patientBirthDate') || '';
    const sDate = dom.studyDate || p.studyDate || metaField(first, 'studyDate') || '';
    const sDesc = dom.studyDescription || p.studyDescription || metaField(first, 'studyDescription') || '';
    const acc = dom.accessionNumber || p.accessionNumber || metaField(first, 'accessionNumber') || '';

    return ctx.normalizeStudy({
      adapter: 'MACH7',
      studyUid: study,
      patient: {
        name: patName,
        id: patId,
        birthDate: bDate,
        studyDate: sDate,
        description: sDesc,
        accession: acc
      },
      series,
      context: { groups, completeKnown: false, mach7: true }
    });
  },
  async enumerate(inv, selected, ctx) {
    const set = new Set(selected), tasks = [];
    const groups = inv.context?.groups || [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi], choice = g.choice || inv.series[gi];
      if (!choice || !set.has(choice.id)) continue;
      const folder = seriesFolderName(choice, gi);
      for (let i = 0; i < g.entries.length; i++) {
        const e = g.entries[i];
        const actualSop = uid(metaField(e, 'sopInstanceUid'));
        const actualStudy = uid(metaField(e, 'studyUid')) || uid(inv.studyUid);
        const actualSeries = uid(metaField(e, 'seriesUid')) || uid(choice.seriesUid);
        const nRaw = metaField(e, 'instanceNumber');
        const n = /^\d+$/.test(nRaw) ? String(Number(nRaw)).padStart(5, '0') : String(i + 1).padStart(5, '0');
        const token = actualSop ? sanitizeSegment(actualSop.slice(-24), 'uid') : String(i + 1).padStart(5, '0');
        tasks.push({
          strategy: 'fetch-dicom',
          url: e.url,
          method: String(e.method || 'GET').toUpperCase(),
          requestBody: e.requestBody || null,
          contentType: e.contentType || '',
          headers: ctx.headersForUrl(e.url),
          studyUid: actualStudy,
          seriesUid: actualSeries,
          sopInstanceUid: actualSop,
          relativePath: `${folder}/IM_${n}_${token}.dcm`
        });
      }
    }
    return tasks;
  }
};
