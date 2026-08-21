import jsQR from '../lib/jsqr.js';

if (typeof jsQR !== 'function') {
  throw new Error(`jsQR is not a function, got: ${typeof jsQR}`);
}
console.log('jsQR import successful! Type:', typeof jsQR);
