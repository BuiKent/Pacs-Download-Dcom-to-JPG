export function resolveBulkDicomSaveMode(hasWritableFolder, _requestedMode = '') {
  if (!hasWritableFolder) {
    throw new Error('Select a writable folder before downloading DICOM.');
  }
  return 'filesystem';
}
