// Multer keeps the file in memory, then we stream it to Cloudinary.
// Nothing is saved on the server's disk.
const multer = require('multer');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ID_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

function fileUpload(fieldName, maxMb, allowedTypes, wrongTypeKey) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) cb(null, true);
      else cb(new Error('WRONG_TYPE'));
    }
  }).single(fieldName);

  // wrap multer so errors become friendly messages instead of crashes
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();

      if (err.code === 'LIMIT_FILE_SIZE') {
        req.uploadError = req.t('upload.too_big', { size: maxMb });
      } else if (err.message === 'WRONG_TYPE') {
        req.uploadError = req.t(wrongTypeKey);
      } else {
        req.uploadError = req.t('upload.failed');
      }
      next();
    });
  };
}

function imageUpload(fieldName, maxMb) {
  return fileUpload(fieldName, maxMb, IMAGE_TYPES, 'upload.wrong_type');
}

// ID documents can also be a PDF
function idUpload(fieldName) {
  return fileUpload(fieldName, 5, ID_TYPES, 'upload.wrong_type_id');
}

// admin only: the onboarding video
function videoUpload(fieldName) {
  return fileUpload(fieldName, 50, VIDEO_TYPES, 'upload.wrong_type_video');
}

module.exports = { imageUpload, idUpload, videoUpload };
