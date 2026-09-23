/**
 * A minimal Part-10 object with no Pixel Data: what a Siemens PhoenixZIPReport
 * (Enhanced SR) looks like to the engine. Explicit VR little endian throughout.
 */
function element(group, elementNumber, vr, value) {
  const pad = vr === 'UI' ? String.fromCharCode(0) : ' ';
  const text = value.length % 2 ? value + pad : value;
  const out = new Uint8Array(8 + text.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, group, true);
  view.setUint16(2, elementNumber, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);
  view.setUint16(6, text.length, true);
  for (let i = 0; i < text.length; i++) out[8 + i] = text.charCodeAt(i);
  return out;
}

export const ENHANCED_SR_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.88.22';

export function nonImageDicom() {
  const parts = [
    new Uint8Array(128),
    new TextEncoder().encode('DICM'),
    element(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
    element(0x0008, 0x0016, 'UI', ENHANCED_SR_SOP_CLASS),
    element(0x0008, 0x0018, 'UI', '1.2.3.4.5'),
    element(0x0008, 0x0060, 'CS', 'SR'),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
