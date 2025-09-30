const pool = require('../dbconfig');
const bcrypt = require('bcrypt');
// const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { stat } = require('fs');

// const EMAIL_FROM = process.env.EMAIL_FROM ;
// const EMAIL_PASS = process.env.EMAIL_PASS ;
// const EMAIL_HOST = process.env.EMAIL_HOST ;
// const EMAIL_PORT = process.env.EMAIL_PORT ;

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;

// Validation functions
const validateFullName = (fullName) => {
  // Check length (2-55 characters)
  if (fullName.length < 2 || fullName.length > 55) {
    return { isValid: false, error: 'Full name must be between 2 and 55 characters.' };
  }
  
  // Check for alphabetic characters only (including spaces and hyphens)
  const alphabeticRegex = /^[a-zA-Z\s\-']+$/;
  if (!alphabeticRegex.test(fullName)) {
    return { isValid: false, error: 'Full name can only contain alphabetic characters, spaces, hyphens, and apostrophes.' };
  }
  
  // Check for emojis and special characters
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(fullName)) {
    return { isValid: false, error: 'Full name cannot contain emojis.' };
  }
  
  return { isValid: true };
};

const validatePhoneNumber = (phoneNumber) => {
  // Optional '+' at start, followed by 1 to 15 digits
  const phoneRegex = /^\+?\d{1,15}$/;
  
  if (!phoneRegex.test(phoneNumber)) {
    return { isValid: false, error: 'Phone number must be up to 15 digits and may start with a +.' };
  }
  
  return { isValid: true };
};

const validatePassword = (password) => {
  // Check length (8-16 characters)
  if (password.length < 8 || password.length > 16) {
    return { isValid: false, error: 'Password must be between 8 and 16 characters.' };
  }
  
  // Check for alphanumeric and special characters only (no emojis)
  const passwordRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/;
  if (!passwordRegex.test(password)) {
    return { isValid: false, error: 'Password can only contain alphanumeric characters and special symbols. Emojis are not allowed.' };
  }
  
  // Check for emojis specifically
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(password)) {
    return { isValid: false, error: 'Password cannot contain emojis.' };
  }
  
  return { isValid: true };
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }
  
  return { isValid: true };
};

// const transporter = nodemailer.createTransport({
//     host: EMAIL_HOST,
//     port: EMAIL_PORT,
//     secure: false, // true for port 465, false for 587
//     auth: {
//       user: EMAIL_FROM,
//       pass: EMAIL_PASS,
//     },
//     tls: {
//       rejectUnauthorized: false, // Add this line for Gmail in dev
//     },
//   });

// function generateVerificationCode() {
//   return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
// }

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // make sure this folder exists
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase(); // e.g., .jpg
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, uniqueName);
  }
});

// ✅ File type filter for jpg, jpeg, png
const fileFilter = function (req, file, cb) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpg, .jpeg, and .png files are allowed for business logo!'), false);
  }
};

exports.upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // optional: 5MB limit
});

exports.register = async (req, res) => {
  const {
    full_name,
    email,
    password,
    phone_number,
    role, // either "NDIS Member" or "Company"
  } = req.body;

  // Basic validation
  if (!full_name || !email || !password || !phone_number || !role) {
    return res.status(400).json({ error: 'Full name, email, password, phone number, and role are required.' });
  }

  const fullNameValidation = validateFullName(full_name);
  if (!fullNameValidation.isValid) return res.status(400).json({ error: fullNameValidation.error });

  const emailValidation = validateEmail(email);
  if (!emailValidation.isValid) return res.status(400).json({ error: emailValidation.error });

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) return res.status(400).json({ error: passwordValidation.error });

  const phoneValidation = validatePhoneNumber(phone_number);
  if (!phoneValidation.isValid) return res.status(400).json({ error: phoneValidation.error });

  try {
   const existing = await pool.query(
      'SELECT id, is_verified FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].is_verified) {
        // Email already verified
        return res.status(400).json({ error: 'Email already registered and verified.' });
      } else {
        // Email exists but not verified → delete old record
        await pool.query('DELETE FROM users WHERE id = $1', [existing.rows[0].id]);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verification_code = '1234';

    const query = `
      INSERT INTO users (
        full_name, email, password, phone_number, role, verification_code
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;

    const values = [full_name, email, hashedPassword, phone_number, role, verification_code];

    await pool.query(query, values);

    res.status(200).json({
      status: true,
      message: `Registration successful as ${role}. Please verify your email.`,
      data:verification_code
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

exports.updateBusinessDetails = async (req, res) => {

  const user_id = req.user.userId;
  const {    
    business_name,
    business_category,
    business_email,
    business_phone_number,
    abn_number,
    ndis_registration_number,
    website_url,
    year_experience,
    address,
    business_overview
  } = req.body;

  // File from multer
  const business_logo = req.file ? req.file.filename : null;

  if (!user_id) return res.status(400).json({ error: 'User ID is required.' });

  try {
    // Check if user exists and is a company
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (userCheck.rows[0].role !== 'Company') return res.status(400).json({ error: 'Only companies can update business details.' });

    // Update query
    const query = `
      UPDATE users SET
        business_name = $1,
        business_category = $2,
        business_email = $3,
        business_phone_number = $4,
        business_logo = $5,
        abn_number = $6,
        ndis_registration_number = $7,
        website_url = $8,
        year_experience = $9,
        address = $10,
        business_overview = $11
      WHERE id = $12
    `;

    const values = [
      business_name || null,
      business_category || null,
      business_email || null,
      business_phone_number || null,
      business_logo || null,
      abn_number || null,
      ndis_registration_number || null,
      website_url || null,
      year_experience || null,
      address || null,
      business_overview || null,
      user_id
    ];

    await pool.query(query, values);

    res.status(200).json({
      status: true,
      message: 'Business details updated successfully.'
    });

  } catch (err) {
    console.error('Business update error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

exports.verifyEmail = async (req, res) => {
  const { email, code, type } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }
  try {
    
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userRes.rows[0];
    if (user.is_verified && type === 'register') {
      return res.status(400).json({ error: 'Email already verified.' });
    }
    if (user.verification_code !== code && type === 'register') {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    await pool.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE id = $1', [user.id]);
    
    // Issue JWT after verification
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      status: true,
      message: 'Email verified successfully.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
        is_verified: true, // since just verified
        profile_image_url: user.profile_image ? `${BASE_IMAGE_URL}/${user.profile_image}` : null,
        profile_image: user.profile_image,
        date_of_birth: user.date_of_birth,
        gender: user.gender,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (err) {
    console.error('Email verification error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

exports.resendVerificationCode = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    const userRes = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userRes.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ error: 'Email already verified.' });
    }
    const newCode = '1234';
    await pool.query('UPDATE users SET verification_code = $1 WHERE id = $2', [newCode, user.id]);
    // Commented out email sending for now
    // await transporter.sendMail({
    //   from: EMAIL_FROM,
    //   to: email,
    //   subject: 'Resend: Verify your email',
    //   text: `Your new verification code is: ${newCode}`,
    //   html: `<p>Your new verification code is: <b>${newCode}</b></p>`
    // });
    res.json({status: true, message: 'Verification code resent.', verification_code: newCode });
  } catch (err) {
    console.error('Resend verification error:', err.message);
    res.status(500).json({status: false, error: 'Internal server error.' });
  }
};

exports.addAdditionalDetails = async (req, res) => {
  const { date_of_birth, gender, skipped } = req.body;
  let profile_image = null;
  const email = req.user.email;
  if (!email) {
    return res.status(400).json({ error: 'User email not found in token.' });
  }
  if (skipped === 'true' || skipped === true) {
    // Mark as skipped in user_onboarding_skips
    const userId = req.user.userId;
    try {
      await pool.query(
        `INSERT INTO user_onboarding_skips (user_id, step_name) VALUES ($1, $2)
         ON CONFLICT (user_id, step_name) DO NOTHING`,
        [userId, 'additional_details']
      );
      return res.json({ status: true, message: 'User skipped additional details.' });
    } catch (err) {
      console.error('Skip additional details error:', err.message);
      return res.status(500).json({ status: false, error: 'Internal server error.' });
    }
  }
  if (req.file) {
    profile_image = req.file.filename;
  }
  try {
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found.' });
    }
    await pool.query(
      `UPDATE users SET profile_image = COALESCE($1, profile_image), date_of_birth = COALESCE($2, date_of_birth), gender = COALESCE($3, gender) WHERE email = $4`,
      [profile_image, date_of_birth, gender, email]
    );
    // Fetch updated user details
    const updatedUserRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const updatedUser = updatedUserRes.rows[0];
    res.json({
      status: true,
      message: 'Additional details updated successfully.',
      user: {
        id: updatedUser.id,
        full_name: updatedUser.full_name,
        email: updatedUser.email,
        phone_number: updatedUser.phone_number,
        role: updatedUser.role,
        is_verified: updatedUser.is_verified,
        profile_image_url: updatedUser.profile_image ? `${BASE_IMAGE_URL}/${updatedUser.profile_image}` : null,
        profile_image: updatedUser.profile_image,
        date_of_birth: updatedUser.date_of_birth,
        gender: updatedUser.gender,
        created_at: updatedUser.created_at,
        updated_at: updatedUser.updated_at
      }
    });
  } catch (err) {
    console.error('Additional details update error:', err.message);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  
  // New comprehensive validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  
  // Validate email
  const emailValidation = validateEmail(email);
  if (!emailValidation.isValid) {
    return res.status(400).json({ error: emailValidation.error });
  }
  
  // Validate password (basic check for login)
  if (password.length < 1) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  try {
    const userResData = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResData.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userResData.rows[0];
    if (!user.is_verified) {
      return res.status(403).json({ error: 'Email not verified.' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    // Issue JWT
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    // res.json({ token });

    const userId = user.id;

    // Check skips
    const skipRes = await pool.query(
      'SELECT step_name FROM user_onboarding_skips WHERE user_id = $1',
      [userId]
    );
    const skipped = skipRes.rows.map(r => r.step_name);

    // Check additional details (profile_image, date_of_birth, gender)
    const userRes = await pool.query(
      'SELECT profile_image, date_of_birth, gender FROM users WHERE id = $1',
      [userId]
    );
    let has_completed_additional_details = false;
    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      has_completed_additional_details = !!(user.profile_image && user.date_of_birth && user.gender);
    }
    if (skipped.includes('additional_details')) has_completed_additional_details = true;

    // Check location & accessibility
    const locRes = await pool.query(
      'SELECT id FROM location_accessibility WHERE user_id = $1',
      [userId]
    );
    let has_completed_location_accessibility = locRes.rows.length > 0;
    if (skipped.includes('location_accessibility')) has_completed_location_accessibility = true;

    // Check NDIS information
    const ndisRes = await pool.query(
      'SELECT id FROM ndis_information WHERE user_id = $1',
      [userId]
    );
    let has_completed_ndis_information = ndisRes.rows.length > 0;
    if (skipped.includes('ndis_information')) has_completed_ndis_information = true;


    const businessRes = await pool.query(
      'SELECT business_name, business_category, business_email, business_phone_number, abn_number,year_experience FROM users WHERE id = $1',
      [userId]
    );
    let has_completed_business_details = false;
    if (businessRes.rows.length > 0) {
      const user = businessRes.rows[0];
      has_completed_business_details = !!(user.business_name && user.business_category && user.business_email && user.business_phone_number && user.abn_number && user.year_experience);
    }
    if (skipped.includes('business_details')) has_completed_business_details = true;
    
    const skipData = {
        has_completed_additional_details,
        has_completed_location_accessibility,
        has_completed_ndis_information,
        has_completed_business_details,
    }

    // Base user object
    const userData = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
      is_verified: user.is_verified,
      profile_image_url: user.profile_image
        ? `${BASE_IMAGE_URL}/${user.profile_image}`
        : null,
      profile_image: user.profile_image,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      created_at: user.created_at,
      updated_at: user.updated_at
    };

    // ✅ If company, add business details
    if (user.role === 'Company') {
      userData.business_details = {
        business_name: user.business_name,
        business_category: user.business_category,
        business_email: user.business_email,
        business_phone_number: user.business_phone_number,
        business_logo: user.business_logo
          ? `${BASE_IMAGE_URL}/${user.business_logo}`
          : null,
        abn_number: user.abn_number,
        ndis_registration_number: user.ndis_registration_number,
        website_url: user.website_url,
        year_experience: user.year_experience,
        address: user.address,
        business_overview: user.business_overview
      };
    }

    res.json({
      status: true,
      message: 'Login successful.',
      token,
      data: {skipData,user:userData} ,
      
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Update onboarding status check to include skips
exports.checkOnboardingCompletion = async (req, res) => {
  const userId = req.user.userId;
  try {
    // Check skips
    const skipRes = await pool.query(
      'SELECT step_name FROM user_onboarding_skips WHERE user_id = $1',
      [userId]
    );
    const skipped = skipRes.rows.map(r => r.step_name);

    // Check additional details (profile_image, date_of_birth, gender)
    const userRes = await pool.query(
      'SELECT profile_image, date_of_birth, gender FROM users WHERE id = $1',
      [userId]
    );
    let has_completed_additional_details = false;
    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      has_completed_additional_details = !!(user.profile_image && user.date_of_birth && user.gender);
    }
    if (skipped.includes('additional_details')) has_completed_additional_details = true;

    // Check location & accessibility
    const locRes = await pool.query(
      'SELECT id FROM location_accessibility WHERE user_id = $1',
      [userId]
    );
    let has_completed_location_accessibility = locRes.rows.length > 0;
    if (skipped.includes('location_accessibility')) has_completed_location_accessibility = true;

    // Check NDIS information
    const ndisRes = await pool.query(
      'SELECT id FROM ndis_information WHERE user_id = $1',
      [userId]
    );
    let has_completed_ndis_information = ndisRes.rows.length > 0;
    if (skipped.includes('ndis_information')) has_completed_ndis_information = true;


    const businessRes = await pool.query(
      'SELECT business_name, business_category, business_email, business_phone_number, abn_number,year_experience FROM users WHERE id = $1',
      [userId]
    );
    let has_completed_business_details = false;
    if (businessRes.rows.length > 0) {
      const user = businessRes.rows[0];
      has_completed_business_details = !!(user.business_name && user.business_category && user.business_email && user.business_phone_number && user.abn_number && user.year_experience);
    }
    if (skipped.includes('business_details')) has_completed_business_details = true;



    // Fetch full user details
    const fullUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = fullUserRes.rows[0];
    res.json({
      status: true,
      data:{
        has_completed_additional_details,
        has_completed_location_accessibility,
        has_completed_ndis_information,
        has_completed_business_details,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          role: user.role,
          is_verified: user.is_verified,
          profile_image_url: user.profile_image ? `${BASE_IMAGE_URL}/${user.profile_image}` : null,
          profile_image: user.profile_image,
          date_of_birth: user.date_of_birth,
          gender: user.gender,
          created_at: user.created_at,
          updated_at: user.updated_at
        }
      }
    });
  } catch (err) {
    console.error('Onboarding completion check error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Logout API (stateless)
exports.logout = (req, res) => {
  // For JWT, logout is handled on the client by deleting the token.
  res.status(200).json({status: true, message: 'Logged out successfully' });
};



exports.updateProfile = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  const {
    full_name,
    email,
    phone_number,
    date_of_birth,
    gender,
    // company specific
    business_name,
    business_category,
    business_email,
    business_phone_number,
    abn_number,
    ndis_registration_number,
    website_url,
    year_experience,
    address,
    business_overview
  } = req.body;

  try {
    // Fetch existing user
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found' });
    }

    const user = userRes.rows[0];

    // Validate inputs
    if (full_name) {
      const nameValidation = validateFullName(full_name);
      if (!nameValidation.isValid) return res.status(400).json({ status: false, error: nameValidation.error });
    }

    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) return res.status(400).json({ status: false, error: emailValidation.error });
    }

    if (phone_number) {
      const phoneValidation = validatePhoneNumber(phone_number);
      if (!phoneValidation.isValid) return res.status(400).json({ status: false, error: phoneValidation.error });
    }

    // Handle optional file uploads (use existing if not provided)
    let profile_image = user.profile_image;
    let business_logo = user.business_logo;

    if (req.files) {
      if (req.files['profile_image'] && req.files['profile_image'][0]) {
        profile_image = req.files['profile_image'][0].filename;
      }

      if (req.files['business_logo'] && req.files['business_logo'][0]) {
        business_logo = req.files['business_logo'][0].filename;
      }
    }

    console.log(profile_image);
    console.log(req.files);
    
    
    // Build update fields
    const fields = [];
    const values = [];
    let index = 1;

    if (full_name) {
      fields.push(`full_name = $${index++}`);
      values.push(full_name);
    }

    if (email) {
      fields.push(`email = $${index++}`);
      values.push(email);
    }

    if (phone_number) {
      fields.push(`phone_number = $${index++}`);
      values.push(phone_number);
    }

    if (date_of_birth) {
      fields.push(`date_of_birth = $${index++}`);
      values.push(date_of_birth);
    }

    if (gender) {
      fields.push(`gender = $${index++}`);
      values.push(gender);
    }

    if (profile_image) {
      fields.push(`profile_image = $${index++}`);
      values.push(profile_image);
    }

    if (user.role === 'Company') {
      if (business_name) {
        fields.push(`business_name = $${index++}`);
        values.push(business_name);
      }

      if (business_category) {
        fields.push(`business_category = $${index++}`);
        values.push(business_category);
      }

      if (business_email) {
        fields.push(`business_email = $${index++}`);
        values.push(business_email);
      }

      if (business_phone_number) {
        fields.push(`business_phone_number = $${index++}`);
        values.push(business_phone_number);
      }

      if (business_logo) {
        fields.push(`business_logo = $${index++}`);
        values.push(business_logo);
      }

      if (abn_number) {
        fields.push(`abn_number = $${index++}`);
        values.push(abn_number);
      }

      if (ndis_registration_number) {
        fields.push(`ndis_registration_number = $${index++}`);
        values.push(ndis_registration_number);
      }

      if (website_url) {
        fields.push(`website_url = $${index++}`);
        values.push(website_url);
      }

      if (year_experience) {
        fields.push(`year_experience = $${index++}`);
        values.push(year_experience);
      }

      if (address) {
        fields.push(`address = $${index++}`);
        values.push(address);
      }

      if (business_overview) {
        fields.push(`business_overview = $${index++}`);
        values.push(business_overview);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ status: false, error: 'No data provided for update.' });
    }
console.log(fields);
console.log(values);


    // Append updated_at and user_id to the query
    const query = `
      UPDATE users
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${index}
    `;

    values.push(user_id);

    await pool.query(query, values);

    res.json({ status: true, message: 'Profile updated successfully' });

  } catch (err) {
    console.error('Profile Update Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update profile' });
  }
};

exports.changePassword = async (req, res) => {
  const user_id = req.user?.userId;
  const { current_password, new_password } = req.body;

  if (!user_id) return res.status(401).json({ status: false, error: 'Unauthorized' });
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }

  // Validate new password
  const passwordValidation = validatePassword(new_password);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ status: false, error: passwordValidation.error });
  }

  try {
    // Fetch user by ID
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found.' });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({ status: false, error: 'Current password is incorrect.' });
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, user_id]);

    res.json({  message: 'Password changed successfully.', status: true });
  } catch (err) {
    console.error('Change Password Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to change password.' });
  }
};

exports.getProfile = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await pool.query(
      `SELECT 
        id,
        full_name,
        email,
        phone_number,
        role,
        profile_image,
        date_of_birth,
        gender,
        is_verified,
        created_at,
        updated_at,
        business_name,
        business_category,
        business_email,
        business_phone_number,
        business_logo,
        abn_number,
        ndis_registration_number,
        website_url,
        year_experience,
        address,
        business_overview
      FROM users 
      WHERE id = $1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];

    // Format date_of_birth
    user.date_of_birth = user.date_of_birth
      ? new Date(user.date_of_birth.getTime() + 5.5 * 60 * 60 * 1000) // adjust for timezone
          .toISOString()
          .split('T')[0]
      : null;

    // Attach profile image URL if exists
    user.profile_image_url = user.profile_image
      ? `${BASE_IMAGE_URL}/${user.profile_image}`
      : null;

    // Only include company fields if role is Company
    let companyDetails = null;
    if (user.role === 'Company') {
      companyDetails = {
        business_name: user.business_name,
        business_category: user.business_category,
        business_email: user.business_email,
        business_phone_number: user.business_phone_number,
        business_logo_url: user.business_logo
          ? `${BASE_IMAGE_URL}/${user.business_logo}`
          : null,
        abn_number: user.abn_number,
        ndis_registration_number: user.ndis_registration_number,
        website_url: user.website_url,
        year_experience: user.year_experience,
        address: user.address,
        business_overview: user.business_overview,
      };
    }

    // Prepare final response
    const response = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
      profile_image_url: user.profile_image_url,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      is_verified: user.is_verified,
      created_at: user.created_at,
      updated_at: user.updated_at,
      business_details: companyDetails, // null if not Company
    };

    res.json({ status: true, data: response });
  } catch (err) {
    console.error('Get Profile Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch profile.' });
  }
};