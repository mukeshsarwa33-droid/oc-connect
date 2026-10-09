// OC Connect High-Performance Disk Storage Engine
// Offloads binary media (photos, documents, voice notes) from Node memory to disk

const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const DIRS = {
  photos: path.join(UPLOADS_ROOT, 'photos'),
  documents: path.join(UPLOADS_ROOT, 'documents'),
  voice: path.join(UPLOADS_ROOT, 'voice'),
  avatars: path.join(UPLOADS_ROOT, 'avatars')
};

// Ensure all uploads directories exist
for (const key in DIRS) {
  if (!fs.existsSync(DIRS[key])) {
    fs.mkdirSync(DIRS[key], { recursive: true });
  }
}

// MIME Type Mapping
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

/**
 * Saves a base64 or DataURL to disk asynchronously
 * @param {string} dataUrl - e.g. "data:image/jpeg;base64,..." or raw base64
 * @param {'photos'|'documents'|'voice'|'avatars'} category
 * @param {string} originalName - e.g. "Calculus_Notes.pdf"
 * @param {string} mimeType - e.g. "application/pdf"
 * @returns {Promise<{ filename: string, relativePath: string, url: string, size: number, mimeType: string, originalName: string }>}
 */
function saveBase64Media(dataUrl, category = 'documents', originalName = '', mimeType = '') {
  return new Promise((resolve, reject) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      return reject(new Error('Invalid media payload'));
    }

    try {
      let buffer;
      let detectedMime = mimeType || 'application/octet-stream';

      const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      const utf8SvgMatch = dataUrl.match(/^data:image\/svg\+xml;utf8,(.+)$/s);

      if (base64Match) {
        detectedMime = base64Match[1] || detectedMime;
        buffer = Buffer.from(base64Match[2], 'base64');
      } else if (utf8SvgMatch) {
        detectedMime = 'image/svg+xml';
        const decoded = decodeURIComponent(utf8SvgMatch[1]);
        buffer = Buffer.from(decoded, 'utf8');
      } else if (dataUrl.startsWith('data:')) {
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx !== -1) {
          const meta = dataUrl.substring(5, commaIdx);
          const raw = dataUrl.substring(commaIdx + 1);
          if (meta.includes(';base64')) {
            detectedMime = meta.replace(';base64', '') || detectedMime;
            buffer = Buffer.from(raw, 'base64');
          } else {
            detectedMime = meta || detectedMime;
            buffer = Buffer.from(decodeURIComponent(raw), 'utf8');
          }
        } else {
          buffer = Buffer.from(dataUrl, 'utf8');
        }
      } else {
        // Raw base64 or string fallback
        buffer = Buffer.from(dataUrl, 'base64');
      }

      let ext = path.extname(originalName).toLowerCase();
      if (!ext) {
        if (detectedMime.includes('svg')) ext = '.svg';
        else if (detectedMime.includes('png')) ext = '.png';
        else if (detectedMime.includes('webp')) ext = '.webp';
        else if (detectedMime.includes('pdf')) ext = '.pdf';
        else if (detectedMime.includes('webm')) ext = '.webm';
        else if (detectedMime.includes('ogg')) ext = '.ogg';
        else ext = '.jpg';
      }

      const safeBaseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const uniqueName = `${category.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${safeBaseName ? '_' + safeBaseName : ''}${ext}`;
      
      const targetDir = DIRS[category] || DIRS.documents;
      const targetPath = path.join(targetDir, uniqueName);

      fs.writeFile(targetPath, buffer, (err) => {
        if (err) return reject(err);
        const relativeUrl = `/api/uploads/${category}/${uniqueName}`;
        resolve({
          filename: uniqueName,
          diskPath: targetPath,
          url: relativeUrl,
          size: buffer.length,
          mimeType: detectedMime,
          originalName: originalName || uniqueName
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Streams a media file directly to HTTP Response with caching and Range support
 */
function streamMediaFile(category, filename, req, res, asDownload = false, customDownloadName = null) {
  const targetDir = DIRS[category] || DIRS.documents;
  const safeFilename = path.basename(filename);
  const filePath = path.join(targetDir, safeFilename);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found or expired' }));
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = EXT_MIME[ext] || 'application/octet-stream';
    const downloadName = customDownloadName || safeFilename;
    const safeName = encodeURIComponent(downloadName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const disposition = asDownload
      ? `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`
      : `inline; filename="${safeName}"; filename*=UTF-8''${safeName}`;

    // Range Request Support for Audio/Video Scrubbing
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  });
}

module.exports = {
  DIRS,
  saveBase64Media,
  streamMediaFile
};
