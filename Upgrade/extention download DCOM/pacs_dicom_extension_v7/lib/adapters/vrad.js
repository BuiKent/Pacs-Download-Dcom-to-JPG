'use strict';
import { parseVradManifest, bestDetectedRequest, seriesFolderName, sanitizeSegment } from '../pacs.js';

function sopToken(uid, index) {
  const s = String(uid || '').trim();
  return s ? sanitizeSegment(s.slice(-24), 'uid') : String(index).padStart(5, '0');
}

function resolveVradBase(manifestUrl, rawBase, templateUrl) {
  if (templateUrl) {
    try {
      const u = new URL(templateUrl);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {}
  }
  try {
    const mu = new URL(manifestUrl);
    let path = '/imageserver/dicomData/GetImage';
    if (rawBase) {
      try {
        const ru = new URL(rawBase);
        path = ru.pathname || path;
      } catch {
        if (rawBase.startsWith('/')) path = rawBase;
      }
    }
    return `${mu.protocol}//${mu.host}${path}`;
  } catch {
    return rawBase || '';
  }
}

export const VradAdapter = {
  id: 'VRAD',
  match(summary) {
    return summary?.detector === 'VRAD' || Boolean(bestDetectedRequest(summary?.requests || [], ['VRAD_MANIFEST']));
  },
  async analyze(ctx) {
    const man = bestDetectedRequest(ctx.summary.requests, ['VRAD_MANIFEST']);
    if (!man) throw new Error('VRAD manifest not detected.');
    const payload = await ctx.fetchJson(man.url, 'application/json', man);
    const p = parseVradManifest(payload);
    const template = bestDetectedRequest(ctx.summary.requests, ['DICOM_IMAGE_API']);
    return ctx.normalizeStudy({
      adapter: 'VRAD',
      studyUid: String(p.study?.StuInsUID || p.study?.StudyInstanceUID || ''),
      patient: p.patient,
      series: p.series,
      context: { manifestUrl: man.url, templateUrl: template?.url || '', completeKnown: true }
    });
  },
  async enumerate(inv, selected, ctx) {
    const state = ctx.state;
    const req = (state.pacsRequests || []).find(x => x.type === 'VRAD_MANIFEST' && x.url === inv.context.manifestUrl);
    const payload = await ctx.fetchJson(inv.context.manifestUrl, 'application/json', req);
    const p = parseVradManifest(payload);
    const selectedSet = new Set(selected);
    const manifestUrl = inv.context.manifestUrl;
    const base = resolveVradBase(manifestUrl, p.rawSeries[0]?.ImageBaseUrl, inv.context.templateUrl);
    if (!base) throw new Error('Cannot determine VRAD image server endpoint.');

    let baseParams = new URLSearchParams();
    if (inv.context.templateUrl) {
      try { baseParams = new URLSearchParams(new URL(inv.context.templateUrl).search); } catch {}
    }

    const tasks = [];
    let expected = 0;
    for (let si = 0; si < p.rawSeries.length; si++) {
      const raw = p.rawSeries[si], choice = p.series[si];
      if (!selectedSet.has(choice.id)) continue;
      expected += Number(raw.ImageCount || 0) || 0;
      const folder = seriesFolderName(choice, si);
      let k = 0;
      for (const im of (raw.ImageList || [])) {
        k++;
        const qs = new URLSearchParams(baseParams);
        if (im.WebUrl) {
          try {
            const uq = new URLSearchParams(String(im.WebUrl).replace(/^\?/, ''));
            for (const [key, val] of uq) qs.set(key, val);
          } catch {}
        }
        if (im.Signature) qs.set('signature', im.Signature);
        if (raw.SeriesInsUID) qs.set('seriesuid', raw.SeriesInsUID);
        if (raw.StuInsUID) qs.set('studyuid', raw.StuInsUID);
        if (im.SOPInstanceUID) qs.set('imageUid', im.SOPInstanceUID);
        if (im.ImageID !== undefined) qs.set('imageid', String(im.ImageID));
        if (raw.Expires || im.Expires) qs.set('expires', String(raw.Expires || im.Expires));

        const sop = String(im.SOPInstanceUID || '').trim();
        tasks.push({
          strategy: 'fetch-dicom',
          url: `${base}?${qs}`,
          headers: ctx.headersForUrl(base),
          method: 'GET',
          studyUid: inv.studyUid,
          seriesUid: choice.seriesUid || '',
          sopInstanceUid: sop,
          relativePath: `${folder}/IM_${String(k).padStart(5, '0')}_${sopToken(sop, k)}.dcm`
        });
      }
    }
    if (expected && tasks.length < expected) {
      throw new Error(`Manifest lists ${expected} images but only generated ${tasks.length} DICOM URLs.`);
    }
    return tasks;
  }
};

