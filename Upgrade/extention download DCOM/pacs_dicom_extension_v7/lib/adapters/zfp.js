'use strict';
import { zfpSeriesChoices, seriesFolderName, sanitizeSegment } from '../pacs.js';

/**
 * GE Centricity Universal Viewer — Zero Footprint.
 *
 * Distinct from other adapters: GE ZFP does not fetch images over HTTP.
 * Study structure is captured from WebSockets by `zfp-hook.js` and retrieved via `ctx.zfpInfo()`.
 */
function sopToken(uid, index) {
  const s = String(uid || '').trim();
  return s ? sanitizeSegment(s.slice(-24), 'uid') : String(index).padStart(5, '0');
}

export const ZfpAdapter = {
  id: 'ZFP',
  match(summary) {
    return summary?.detector === 'ZFP' || Boolean(summary?.zfpGroups?.length);
  },
  async analyze(ctx) {
    const info = ctx.summary?.zfpInfo || await ctx.zfpInfo?.();
    const groups = info?.groups || [];
    if (!groups.length) {
      throw new Error('Could not read study structure from GE viewer. Reload the viewer tab and rescan.');
    }
    const study = info.study || {};
    const demo = study.patientDemographics || {};
    const name = String((demo.patientName || {}).personNameString || '').trim();
    const dt = String(study.studyDateTime || '');
    return ctx.normalizeStudy({
      adapter: 'ZFP',
      studyUid: groups[0]?.studyInstanceUid || String(study.studyId || ''),
      patient: {
        name,
        id: String(demo.patientId || ''),
        birthDate: String(demo.patientBirthDate || '').replace(/-/g, ''),
        studyDate: dt.split(' ')[0].replace(/-/g, ''),
        description: (study.mappedStudyDescription || {})[groups[0]?.studyInstanceUid] || '',
        accession: String(demo.accessionNumber || ''),
      },
      series: zfpSeriesChoices(groups),
      context: {viewerUrl: ctx.summary?.currentUrl || '', completeKnown: true},
    });
  },
  async enumerate(inv, selected, ctx) {
    const info = ctx.summary?.zfpInfo || await ctx.zfpInfo?.();
    const groups = info?.groups || [];
    if (!groups.length) throw new Error('GE study structure lost — reload the viewer and try again.');
    const study = info.study || {};
    // Include only study fields required for DICOM reconstruction
    const studySlim = {
      patientDemographics: study.patientDemographics,
      studyDateTime: study.studyDateTime,
      mappedStudyDescription: study.mappedStudyDescription,
    };
    const choices = zfpSeriesChoices(groups);
    const set = new Set(selected), tasks = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const choice = choices[gi];
      if (!set.has(choice.id)) continue;
      const group = groups[gi], folder = seriesFolderName(choice, gi);
      const groupSlim = {
        studyInstanceUid: group.studyInstanceUid, groupId: group.groupId,
        description: group.description, modalities: group.modalities,
      };
      const sops = group.dicomSops || [];
      for (let i = 0; i < sops.length; i++) {
        const sop = sops[i];
        if (!sop?.sopInstanceUid) continue;
        const n = Number(sop.instanceNumber) > 0
          ? String(Number(sop.instanceNumber)).padStart(5, '0')
          : String(i + 1).padStart(5, '0');
        tasks.push({
          strategy: 'zfp-image',
          zfp: {
            studyUid: group.studyInstanceUid, groupId: group.groupId,
            sop: `${sop.sopInstanceUid}#0`, sopRow: sop, group: groupSlim, study: studySlim,
          },
          studyUid: inv.studyUid || group.studyInstanceUid || '',
          seriesUid: choice.seriesUid || sop.seriesInstanceUid || '',
          sopInstanceUid: sop.sopInstanceUid,
          relativePath: `${folder}/IM_${n}_${sopToken(sop.sopInstanceUid, i + 1)}.dcm`,
        });
      }
    }
    return tasks;
  }
};

