import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const task = getDocument({ data: new Uint8Array(workerData), isEvalSupported: false, useSystemFonts: true, stopAtErrors: true, verbosity: 0 });
try {
  const document = await task.promise;
  if (document.numPages > 30) throw new Error('PDF exceeds 30 pages.');
  let text = '';
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    text += content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') + '\n';
    if (text.length > 250_000) throw new Error('PDF text exceeds import limit.');
  }
  if (!text.trim()) throw new Error('Scanned PDF needs OCR.');
  parentPort.postMessage({ text });
} catch { parentPort.postMessage({ error: 'PDF could not be read.' }); }
finally { await task.destroy(); }
