// ============================================================================
// zip.js - lazy-loaded JSZip wrapper for multi-file archive transfers
//
// JSZip (~100KB) is only loaded when the user actually chooses "Send as ZIP".
// For single-file or individual-file transfers, this module is never called
// and the library is never downloaded.
// ============================================================================

const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let jszipPromise = null;

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => {
        jszipPromise = null; // allow retry
        reject(new Error('Failed to load JSZip library'));
      };
      document.head.appendChild(script);
    });
  }
  return jszipPromise;
}

// Sanitize a path so it cannot escape the archive root (no ../, no absolute paths).
function sanitizeZipPath(path) {
  let p = String(path || '').replace(/\\/g, '/');
  p = p.replace(/^([a-zA-Z]:)?\/+/, ''); // strip drive prefix + leading slashes
  p = p.split('/').filter(seg => seg !== '..' && seg !== '.').join('/');
  return p;
}

// Deduplicate entry names by appending " (n)" before the extension.
function dedupeName(name, used) {
  let finalName = name;
  let counter = 1;
  while (used.has(finalName)) {
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      finalName = name.slice(0, dot) + ' (' + counter + ')' + name.slice(dot);
    } else {
      finalName = name + ' (' + counter + ')';
    }
    counter++;
  }
  used.add(finalName);
  return finalName;
}

// Create a ZIP archive from an array of File objects.
// Preserves webkitRelativePath for folder structure when present.
// Returns a File object ready for sendFile().
async function createZip(files, options = {}) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const usedNames = new Set();
  const list = Array.from(files);

  for (const file of list) {
    const originalPath = file.webkitRelativePath || file.name;
    const safePath = sanitizeZipPath(originalPath);
    const finalPath = dedupeName(safePath || file.name, usedNames);
    zip.file(finalPath, file);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const filename = options.filename || 'webdrop-files.zip';
  return new File([blob], filename, { type: 'application/zip' });
}

export { createZip, sanitizeZipPath, dedupeName };
