'use strict';
import { parseVradManifest, bestDetectedRequest, seriesFolderName, sanitizeSegment, extractVradShareId } from '../pacs.js';

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

function resolveVradApiBase(url) {
  try {
    const u = new URL(url);
    const port = u.port === '7198' ? '7194' : (u.port || '7194');
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return '';
  }
}

async function synthesizeVradManifest(ctx, shareId, viewerUrl) {
  const apiBase = resolveVradApiBase(viewerUrl);
  if (!apiBase) throw new Error('Cannot resolve VRAD image server base address.');
  const shareInfoUrl = `${apiBase}/imageserver/StudyData/GetShareInfo?shareId=${encodeURIComponent(shareId)}`;
  const infoRes = await ctx.fetchJson(shareInfoUrl, 'application/json');
  const d = infoRes?.data || infoRes;
  if (!d || !d.serverSignature || !d.serverAddr) {
    throw new Error(infoRes?.message || 'Failed to retrieve VRAD share info from server.');
  }
  const serverSignature = d.serverSignature;
  const serverAddr = d.serverAddr;
  const expires = d.expires || '';
  const sB64 = btoa(serverAddr);
  
  const studiesUrl = `${apiBase}/imageserver/StudyData/GetStudies?dataids=&studyKeys=&cloudImage=1&dataSource=rest&signature=${serverSignature}&vendorCode=link&seriesKeys=&isAnony=false&getImageInfo=false&token=&serverAddr=${encodeURIComponent(sB64)}&expires=${expires}`;
  const studiesRes = await ctx.fetchJson(studiesUrl, 'application/json');
  return { manifestUrl: studiesUrl, payload: studiesRes, apiBase, expires, serverSignature, shareId };
}

export const VradAdapter = {
  id: 'VRAD',
  match(summary) {
    return summary?.detector === 'VRAD'
      || summary?.viewerShell === 'VRAD_SHELL'
      || Boolean(bestDetectedRequest(summary?.requests || [], ['VRAD_MANIFEST']))
      || Boolean(extractVradShareId(summary?.currentUrl || summary?.bestViewerUrl));
  },
  async analyze(ctx) {
    const man = bestDetectedRequest(ctx.summary.requests, ['VRAD_MANIFEST']);
    let manifestUrl = man?.url || '';
    let payload = null;
    let template = bestDetectedRequest(ctx.summary.requests, ['DICOM_IMAGE_API']);
    let synthContext = {};

    if (man && man.url.includes('StudyData/GetStudies')) {
      payload = await ctx.fetchJson(man.url, 'application/json', man);
    } else {
      const shareId = extractVradShareId(man?.url || ctx.summary.currentUrl || ctx.summary.bestViewerUrl);
      if (shareId) {
        const synth = await synthesizeVradManifest(ctx, shareId, man?.url || ctx.summary.currentUrl || ctx.summary.bestViewerUrl);
        manifestUrl = synth.manifestUrl;
        payload = synth.payload;
        synthContext = { apiBase: synth.apiBase, expires: synth.expires, serverSignature: synth.serverSignature, shareId: synth.shareId };
      } else if (man) {
        payload = await ctx.fetchJson(man.url, 'application/json', man);
      }
    }

    if (!payload) throw new Error('VRAD manifest could not be detected or synthesized.');
    const p = parseVradManifest(payload);

    if ((!p.patient?.name || !p.patient?.id) && p.rawSeries?.[0]?.ImageList?.[0]) {
      const s0 = p.rawSeries[0], im0 = s0.ImageList[0];
      if (im0.WebUrl && (synthContext.apiBase || manifestUrl)) {
        try {
          const apiBase = synthContext.apiBase || resolveVradApiBase(manifestUrl);
          const exp = s0.Expires || im0.Expires || synthContext.expires || '';
          const sig = im0.Signature || '';
          const infoUrl = `${apiBase}/imageserver/StudyData/GetDicomSeriesInfo${im0.WebUrl}&expires=${exp}&signature=${sig}&studyuid=${p.study?.StuInsUID || ''}&seriesuid=${s0.SeriesInsUID || ''}&imageUid=${im0.SOPInstanceUID || ''}&ds=rest&forceDownload=true`;
          const seRes = await ctx.fetchJson(infoUrl, 'application/json');
          const d_se = seRes?.data || seRes;
          if (d_se && (d_se.patientName || d_se.patientId)) {
            p.patient.name = String(d_se.patientName || p.patient.name || '');
            p.patient.id = String(d_se.patientId || p.patient.id || '');
            if (d_se.studyDate && !p.patient.studyDate) p.patient.studyDate = String(d_se.studyDate);
            if (d_se.studyDescription && !p.patient.description) p.patient.description = String(d_se.studyDescription);
          }
        } catch {}
      }
    }

    return ctx.normalizeStudy({
      adapter: 'VRAD',
      studyUid: String(p.study?.StuInsUID || p.study?.StudyInstanceUID || ''),
      patient: p.patient,
      series: p.series,
      context: { manifestUrl, templateUrl: template?.url || '', ...synthContext, completeKnown: true }
    });
  },
  async enumerate(inv, selected, ctx) {
    const state = ctx.state;
    const req = (state.pacsRequests || []).find(x => x.type === 'VRAD_MANIFEST' && x.url === inv.context.manifestUrl);
    let payload = null;
    if (inv.context.manifestUrl) {
      try {
        payload = await ctx.fetchJson(inv.context.manifestUrl, 'application/json', req);
      } catch {}
    }
    if (!payload && inv.context.shareId) {
      const synth = await synthesizeVradManifest(ctx, inv.context.shareId, inv.context.apiBase || inv.summary?.currentUrl);
      payload = synth.payload;
    }
    if (!payload) throw new Error('Cannot load VRAD study structure.');
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
        if (raw.Expires || im.Expires || inv.context.expires) qs.set('expires', String(raw.Expires || im.Expires || inv.context.expires));
        if (!qs.has('lossless')) qs.set('lossless', '1');
        if (!qs.has('iq')) qs.set('iq', '100');

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

