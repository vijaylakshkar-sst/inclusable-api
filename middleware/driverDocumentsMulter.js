const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload path
const uploadDir = path.join(__dirname, '../uploads/drivers');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname.replace(/\s+/g, '_')}`);
  }
});

const uploadFiles = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'license_photo_front', maxCount: 1 },
  { name: 'license_photo_back', maxCount: 1 },
  { name: 'rc_copy', maxCount: 1 },
  { name: 'insurance_copy', maxCount: 1 },
  { name: 'police_check_certificate', maxCount: 1 },
  { name: 'wwvp_card', maxCount: 1 }
]);

module.exports = uploadFiles;