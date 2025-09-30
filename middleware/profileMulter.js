const multer = require('multer');
const path = require('path');

// Storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // ensure this folder exists
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = function (req, file, cb) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error('Only .jpg, .jpeg, and .png files are allowed!');
    error.code = 'LIMIT_FILE_TYPES';
    cb(error, false);
  }
};

// Multer upload
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Middleware to handle multiple fields
const uploadFiles = upload.fields([
  { name: 'profile_image', maxCount: 1 },
  { name: 'business_logo', maxCount: 1 },
]);

module.exports = uploadFiles;
