const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

// Without Cloudinary keys, files are saved on this computer instead,
// so uploads still work while developing. (On Render, use Cloudinary:
// files saved on the server disappear when it restarts.)
const ROOT = path.join(__dirname, '../..');
const LOCAL_PUBLIC = path.join(ROOT, 'public/uploads');   // pictures and video, served by the site
const LOCAL_PRIVATE = path.join(ROOT, 'storage/ids');     // ID documents, never served directly
const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm'
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

function isConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_SECRET);
}

// Settings for each kind of upload
const UPLOAD_TYPES = {
  profile: {
    folder: 'seniorpadi/public/profiles',
    type: 'upload',
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto:low', fetch_format: 'auto' }]
  },
  event: {
    folder: 'seniorpadi/public/events',
    type: 'upload',
    transformation: [{ width: 800, height: 450, crop: 'fill', quality: 'auto:low', fetch_format: 'auto' }]
  },
  video: {
    folder: 'seniorpadi/public/onboarding',
    type: 'upload'
  },
  // Phase 2: ID documents are private and only viewed through signed links
  id: {
    folder: 'seniorpadi/private/ids',
    type: 'private'
  }
};

// Uploads a file buffer from multer (memory storage) straight to Cloudinary
function saveLocally(buffer, kind, mimetype) {
  const ext = EXTENSIONS[mimetype] || 'bin';
  const name = crypto.randomUUID() + '.' + ext;
  if (kind === 'id') {
    fs.mkdirSync(LOCAL_PRIVATE, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_PRIVATE, name), buffer);
    return { url: null, publicId: 'local:ids/' + name, format: ext };
  }
  const dir = path.join(LOCAL_PUBLIC, kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
  return { url: '/uploads/' + kind + '/' + name, publicId: 'local:uploads/' + kind + '/' + name, format: ext };
}

// Uploads a file buffer from multer (memory storage) to Cloudinary,
// or saves it locally if Cloudinary isn't set up.
function uploadBuffer(buffer, kind, mimetype) {
  if (!isConfigured()) return Promise.resolve(saveLocally(buffer, kind, mimetype));

  const options = { ...UPLOAD_TYPES[kind], resource_type: 'auto' };
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id, format: result.format });
    });
    stream.end(buffer);
  });
}

// where a locally saved file lives on disk (null for Cloudinary files)
function localPath(publicId) {
  if (!publicId || !publicId.startsWith('local:')) return null;
  const rest = publicId.slice(6);
  return rest.startsWith('ids/') ? path.join(ROOT, 'storage', rest) : path.join(ROOT, 'public', rest);
}

async function deleteFile(publicId, type = 'upload', resourceType = 'image') {
  const local = localPath(publicId);
  if (local) {
    fs.rm(local, { force: true }, () => {});
    return;
  }
  if (!publicId || !isConfigured()) return;
  try {
    await cloudinary.uploader.destroy(publicId, { type, resource_type: resourceType });
  } catch (err) {
    console.error('Could not delete old file from Cloudinary:', err.message);
  }
}

// Short-lived link for an admin to look at an ID document. Expires in 5 minutes.
function signedIdUrl(publicId, format) {
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: 'image',
    type: 'private',
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60
  });
}

// Onboarding video at 480p with low quality, so it plays on weak connections
function videoUrl(publicId) {
  if (publicId.startsWith('local:')) return '/' + publicId.slice(6);
  return cloudinary.url(publicId, {
    resource_type: 'video',
    format: 'mp4',
    secure: true,
    transformation: [{ width: 854, height: 480, crop: 'limit', quality: 'auto:low' }]
  });
}

module.exports = { cloudinary, isConfigured, uploadBuffer, deleteFile, signedIdUrl, videoUrl, localPath };
