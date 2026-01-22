const pool = require('../dbconfig');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { stat } = require('fs');
const fs = require('fs');
const stripe = require('../stripe');
const { chatNotification } = require('../hooks/notification');

const templatePath = path.join(__dirname, '../emailTemplates/otpEmailTemplate.html');

const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT;

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

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: true, // true for port 465, false for 587
  auth: {
    user: EMAIL_FROM,
    pass: EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // Add this line for Gmail in dev
  },
});

function generateVerificationCode() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
}

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
    // 🔍 Check for existing email (including soft-deleted)
    const existing = await pool.query(
      `SELECT id, is_verified, deleted_at 
      FROM users 
      WHERE email = $1 
      AND deleted_at IS NULL`,
      [email]
    );


    if (existing.rows.length > 0) {
      const user = existing.rows[0];

      if (user.is_verified) {
        // ❌ Already active and verified
        return res.status(400).json({ error: 'Email already registered and verified.' });
      } else {
        // ❌ Exists but not verified (old pending registration)
        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verification_code = generateVerificationCode(); // Generate OTP

    const insertQuery = `
      INSERT INTO users (
        full_name, email, password, phone_number, role, verification_code
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const values = [full_name, email, hashedPassword, phone_number, role, verification_code];
    await pool.query(insertQuery, values);

    // Load and replace placeholders in email template
    let emailTemplate = fs.readFileSync(templatePath, 'utf-8');
    emailTemplate = emailTemplate
      .replace('{{full_name}}', full_name)
      .replace('{{otp}}', verification_code);

    // ✅ Send Email
    const mailOptions = {
      from: `"Inclusable" <${EMAIL_FROM}>`,
      to: email,
      subject: 'Verify Your Email - OTP Code',
      html: emailTemplate,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: true,
      message: `Registration successful as ${role}. OTP has been sent to your email.`,
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
};


exports.updateBusinessDetails = async (req, res) => {
  const user_id = req.user.userId;

  // If sent via form-data, parse arrays from string (e.g. '["a", "b"]' or comma-separated)
  const parseArray = (input) => {
    if (!input) return null;
    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Fallback: comma-separated
      return input.split(',').map(s => s.trim());
    }
  };

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
    business_overview,
    event_types,
    accessibility
  } = req.body;

  const business_logo = req.file ? req.file.filename : null;

  if (!user_id) return res.status(400).json({ error: 'User ID is required.' });

  try {
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (userCheck.rows[0].role !== 'Company') return res.status(400).json({ error: 'Only companies can update business details.' });

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
        business_overview = $11,
        event_types = $12,
        accessibility = $14
      WHERE id = $15
      RETURNING *;
    `;

    const values = [
      business_name || null,
      parseArray(business_category),
      business_email || null,
      business_phone_number || null,
      business_logo || null,
      abn_number || null,
      ndis_registration_number || null,
      website_url || null,
      year_experience || null,
      address || null,
      business_overview || null,
      parseArray(event_types),
      parseArray(accessibility),
      user_id
    ];

    const result = await pool.query(query, values);

    res.status(200).json({
      status: true,
      data: result.rows[0],
      message: 'Business details updated successfully.'
    });

  } catch (err) {
    console.error('Business update error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

exports.verifyEmail = async (req, res) => {
  const { email, code, type, fcm_token } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }
  try {

    // const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const userRes = await pool.query(
      `SELECT * 
   FROM users 
   WHERE email = $1 
   AND deleted_at IS NULL`,
      [email]
    );
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

    if (user.verification_code !== code && type === 'forget') {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    await pool.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE id = $1', [user.id]);


    // Issue JWT after verification
    if (type === 'register') {

      let stripeCustomerId = user.stripe_customer_id;
      const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

      if (fcm_token && fcm_token.trim() !== '') {
       

        await pool.query(
          `UPDATE users 
        SET active_token = $1, 
            fcm_token = $2, 
            last_login_at = NOW() 
        WHERE id = $3`,
          [token, fcm_token || null, user.id]
        );
        console.log(`✅ FCM token updated for user ID: ${user.id}`);
      }



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
          stripe_customer_id: stripeCustomerId,
          profile_image_url: user.profile_image ? `${BASE_IMAGE_URL}/${user.profile_image}` : null,
          profile_image: user.profile_image,
          date_of_birth: user.date_of_birth,
          gender: user.gender,
          stripe_account_status: user.stripe_account_status === '3' ? "Active" : user.stripe_account_status === '2' ? "Under Review" : "Pending",
          created_at: user.created_at,
          updated_at: user.updated_at
        }
      });
    } else {
      res.json({
        status: true,
        message: 'Email verified successfully.',
      });
    }

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
    const userRes = await pool.query('SELECT id, is_verified,full_name FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userRes.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ error: 'Email already verified.' });
    }
    const verification_code = generateVerificationCode(); // Generate OTP
    await pool.query('UPDATE users SET verification_code = $1 WHERE id = $2', [verification_code, user.id]);

    let emailTemplate = fs.readFileSync(templatePath, 'utf-8');

    // Replace placeholders
    emailTemplate = emailTemplate
      .replace('{{full_name}}', user.full_name)
      .replace('{{otp}}', verification_code);

    // ✅ Send Email
    const mailOptions = {
      from: `"Inclusable" <${EMAIL_FROM}>`,
      to: email,
      subject: 'Verify Your Email - OTP Code',
      html: emailTemplate,
    };

    await transporter.sendMail(mailOptions);

    res.json({ status: true, message: 'Verification code resent successfully.' });
  } catch (err) {
    console.error('Resend verification error:', err.message);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
};

exports.addAdditionalDetails = async (req, res) => {
  const { date_of_birth, gender, skipped } = req.body;
  let profile_image = null;

  console.log(req.files, 'profile_image');

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
  if (req.files && req.files.profile_image && req.files.profile_image.length > 0) {
    profile_image = req.files.profile_image[0].filename;
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

  const { email, password, fcm_token } = req.body;
  const client = await pool.connect();

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
    const userResData = await client.query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );

    if (userResData.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or deleted.' });
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
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,   // ✅ FIX
      { expiresIn: "7d" }
    );
    
    // Update FCM token if provided
    if(user.role != "Admin"){
      if (fcm_token && fcm_token.trim() !== '') {
        await client.query(
          `UPDATE users 
          SET active_token = $1, 
              fcm_token = $2, 
              last_login_at = NOW() 
          WHERE id = $3`,
          [token, fcm_token || null, user.id]
        );
        console.log(`✅ FCM token updated for user ID: ${user.id}`);
      }
    }else{
      await client.query(
        `UPDATE users 
        SET active_token = $1, 
            last_login_at = NOW() 
        WHERE id = $2`,
        [token, user.id]
      );
      console.log(`✅ FCM token updated for user ID: ${user.id}`);
    }
    

    const userId = user.id;

    // Check skips
    const skipRes = await client.query(
      'SELECT step_name FROM user_onboarding_skips WHERE user_id = $1',
      [userId]
    );
    const skipped = skipRes.rows.map(r => r.step_name);

    // Check additional details
    const userRes = await client.query(
      'SELECT profile_image, date_of_birth, gender FROM users WHERE id = $1',
      [userId]
    );
    let has_completed_additional_details = false;
    if (userRes.rows.length > 0) {
      const u = userRes.rows[0];
      has_completed_additional_details = !!(u.profile_image && u.date_of_birth && u.gender);
    }
    if (skipped.includes('additional_details'))
      has_completed_additional_details = true;

    // Check location & accessibility
    const locRes = await client.query(
      'SELECT id FROM location_accessibility WHERE user_id = $1',
      [userId]
    );
    let has_completed_location_accessibility = locRes.rows.length > 0;
    if (skipped.includes('location_accessibility'))
      has_completed_location_accessibility = true;

    // Check NDIS information
    const ndisRes = await client.query(
      'SELECT id FROM ndis_information WHERE user_id = $1',
      [userId]
    );
    let has_completed_ndis_information = ndisRes.rows.length > 0;
    if (skipped.includes('ndis_information'))
      has_completed_ndis_information = true;

    // Business details
    const businessRes = await client.query(
      'SELECT business_name, business_category, business_email, business_phone_number, abn_number, year_experience FROM users WHERE id = $1',
      [userId]
    );

    let has_completed_business_details = false;
    if (businessRes.rows.length > 0) {
      const b = businessRes.rows[0];
      has_completed_business_details = !!(
        b.business_name &&
        b.business_category &&
        b.business_email &&
        b.business_phone_number &&
        b.abn_number &&
        b.year_experience
      );
    }
    if (skipped.includes('business_details'))
      has_completed_business_details = true;

    const skipData = {
      has_completed_additional_details,
      has_completed_location_accessibility,
      has_completed_ndis_information,
      has_completed_business_details
    };

    // Base user object
    const userData = {
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
      stripe_customer_id: user.stripe_customer_id,
      stripe_account_status:
        user.stripe_account_status === '3'
          ? 'Active'
          : user.stripe_account_status === '2'
            ? 'Under Review'
            : 'Pending',
      created_at: user.created_at,
      updated_at: user.updated_at,
      fcm_token
    };

    // Add company business details
    if (user.role === 'Company') {
      const querySubscription = `
        SELECT 
          us.subscription_status,
          us.expiry_date,
          sp.id AS plan_id,
          sp.name AS plan_name,
          sp.plan_type,
          sp.price,
          sp.currency,
          sp.description,
          sp.features,
          sp.duration,
          sp.trial_days,
          sp.audience_role,
          sp.is_active,
          sp.icon
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE us.user_id = $1
        ORDER BY us.updated_at DESC
        LIMIT 1;
      `;
      const resultSubscription = await client.query(querySubscription, [userId]);

      userData.business_details = {
        business_name: user.business_name,
        business_category: user.business_category,
        business_email: user.business_email,
        business_phone_number: user.business_phone_number,
        business_logo: user.business_logo ? `${BASE_IMAGE_URL}/${user.business_logo}` : null,
        abn_number: user.abn_number,
        ndis_registration_number: user.ndis_registration_number,
        website_url: user.website_url,
        year_experience: user.year_experience,
        address: user.address,
        business_overview: user.business_overview,
        subscription_status: resultSubscription.rows.length > 0
      };
    }

    // 🚖 Add driver details for Cab Owner
    if (user.role === 'Cab Owner') {
      const driverRes = await client.query(
        `SELECT 
            id,
            cab_type_id,
            vehicle_number,
            license_number,
            status
        FROM drivers
        WHERE user_id = $1
        LIMIT 1`,
        [userId]
      );

      userData.driver_details =
        driverRes.rows.length > 0 ? driverRes.rows[0] : null;
    }

    return res.json({
      status: true,
      message: 'Login successful.',
      token,
      data: { skipData, user: userData }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
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
      data: {
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
exports.logout = async (req, res) => {
  try {
    const userId = req.user?.userId; // assumes auth middleware sets req.user

    if (!userId) {
      return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    // Remove both JWT and FCM tokens
    await pool.query(
      `UPDATE users 
       SET fcm_token = NULL, updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    return res.status(200).json({
      status: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    console.error('Logout Error:', err.message);
    return res.status(500).json({
      status: false,
      error: 'Failed to logout. Please try again.',
    });
  }
};



exports.updateProfile = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ error: "Unauthorized" });

  const {
    full_name,
    email,
    phone_number,
    date_of_birth,
    gender,
    // company-specific
    business_name,
    business_category,
    business_email,
    business_phone_number,
    abn_number,
    ndis_registration_number,
    website_url,
    year_experience,
    address,
    business_overview,
    event_types,
    accessibility,
  } = req.body;

  // 🔹 Helper: safely parse arrays from string or JSON
  const parseArray = (input) => {
    if (!input) return null;
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return input.split(",").map((s) => s.trim());
    }
  };

  try {
    // 🔹 Fetch user
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ status: false, error: "User not found" });
    }

    const user = userRes.rows[0];

    // 🔹 Handle file uploads
    let profile_image = user.profile_image;
    let business_logo = user.business_logo;

    if (req.files) {
      if (req.files["profile_image"]?.[0]) {
        profile_image = req.files["profile_image"][0].filename;
      }
      if (req.files["business_logo"]?.[0]) {
        business_logo = req.files["business_logo"][0].filename;
      }
    }

    // 🔹 Build dynamic SQL update
    const fields = [];
    const values = [];
    let index = 1;

    const pushField = (key, value) => {
      if (value !== undefined && value !== null) {
        fields.push(`${key} = $${index++}`);
        values.push(value);
      }
    };

    pushField("full_name", full_name);
    pushField("email", email);
    pushField("phone_number", phone_number);
    pushField("date_of_birth", date_of_birth);
    pushField("gender", gender);
    pushField("profile_image", profile_image);

    if (user.role === "Company") {
      pushField("business_name", business_name);
      pushField("business_category", parseArray(business_category));
      pushField("event_types", parseArray(event_types));
      pushField("accessibility", parseArray(accessibility));
      pushField("business_email", business_email);
      pushField("business_phone_number", business_phone_number);
      pushField("business_logo", business_logo);
      pushField("abn_number", abn_number);
      pushField("ndis_registration_number", ndis_registration_number);
      pushField("website_url", website_url);
      pushField("year_experience", year_experience);
      pushField("address", address);
      pushField("business_overview", business_overview);
    }

    if (fields.length === 0) {
      return res.status(400).json({ status: false, error: "No data provided for update." });
    }

    const query = `
      UPDATE users
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${index}
      RETURNING *
    `;
    values.push(user_id);

    const result = await pool.query(query, values);
    const updatedUser = result.rows[0];

    // 🔹 Add full URLs
    const profile_image_url = updatedUser.profile_image
      ? `${BASE_IMAGE_URL}/${updatedUser.profile_image}`
      : null;
    const business_logo_url =
      updatedUser.business_logo ? `${BASE_IMAGE_URL}/${updatedUser.business_logo}` : null;

    // 🔹 Build role-based response
    let responseData = {
      id: updatedUser.id,
      full_name: updatedUser.full_name,
      email: updatedUser.email,
      phone_number: updatedUser.phone_number,
      date_of_birth: updatedUser.date_of_birth,
      gender: updatedUser.gender,
      role: updatedUser.role,
      profile_image_url,
    };

    const parseStringToArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return value
          .replace(/[{}]/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }
      return [];
    };


    // Step 2: Fetch NDIS Information
    const ndisResult = await pool.query(
      `SELECT 
        id,
        ndis_number,
        preferred_event_types,
        primary_disability_type,
        support_requirements,
        created_at,
        updated_at
      FROM ndis_information 
      WHERE user_id = $1`,
      [updatedUser.id]
    );

    // Step 5: NDIS Information
    let ndisInfo = null;
    if (ndisResult.rows.length > 0) {
      const ndis = ndisResult.rows[0];
      ndisInfo = {
        ndis_number: ndis.ndis_number,
        preferred_event_types: parseStringToArray(ndis.preferred_event_types),
        primary_disability_type: parseStringToArray(ndis.primary_disability_type),
        support_requirements: parseStringToArray(ndis.support_requirements),
        created_at: ndis.created_at,
        updated_at: ndis.updated_at,
      };
    }


    if (updatedUser.role === "NDIS Member") {
      responseData = {
        ...responseData,
        ndis_information: ndisInfo,
      };
    }
    if (updatedUser.role === "Company") {
      responseData = {
        ...responseData,
        business_name: updatedUser.business_name,
        business_category: updatedUser.business_category,
        business_email: updatedUser.business_email,
        business_phone_number: updatedUser.business_phone_number,
        business_logo_url,
        abn_number: updatedUser.abn_number,
        ndis_registration_number: updatedUser.ndis_registration_number,
        website_url: updatedUser.website_url,
        year_experience: updatedUser.year_experience,
        address: updatedUser.address,
        business_overview: updatedUser.business_overview,
        event_types: updatedUser.event_types,
        accessibility: updatedUser.accessibility
      };
    }

    res.json({
      status: true,
      message: "Profile updated successfully",
      data: responseData,
    });
  } catch (err) {
    console.error("Profile Update Error:", err.message);
    res.status(500).json({ status: false, error: "Failed to update profile" });
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

    res.json({ message: 'Password changed successfully.', status: true });
  } catch (err) {
    console.error('Change Password Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to change password.' });
  }
};

exports.updatePassword = async (req, res) => {

  const { new_password, email } = req.body;

  if (!email) return res.status(400).json({ status: false, error: 'Email required' });

  if (!new_password) {
    return res.status(400).json({ error: 'new passwords is required.' });
  }

  try {
    // Fetch user by ID
    const userResult = await pool.query('SELECT password FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found.' });
    }

    const user = userResult.rows[0];

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE email = $2', [hashedPassword, email]);

    res.json({ message: 'Password changed successfully.', status: true });
  } catch (err) {
    console.error('Change Password Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to change password.' });
  }
};

exports.getProfile = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Step 1: Fetch user
    const userResult = await pool.query(
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
        business_overview,
        event_types,
        stripe_account_status,
        stripe_customer_id,
        accessibility
      FROM users 
      WHERE id = $1`,
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];

    // Step 2: Fetch NDIS Information
    const ndisResult = await pool.query(
      `SELECT 
        id,
        ndis_number,
        preferred_event_types,
        primary_disability_type,
        support_requirements,
        created_at,
        updated_at
      FROM ndis_information 
      WHERE user_id = $1`,
      [user_id]
    );

    const parseStringToArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return value
          .replace(/[{}]/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }
      return [];
    };

    // Step 3: Format fields
    user.date_of_birth = user.date_of_birth
      ? new Date(user.date_of_birth.getTime() + 5.5 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]
      : null;

    const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL || "http://localhost:3000/uploads";

    user.profile_image_url = user.profile_image
      ? `${BASE_IMAGE_URL}/${user.profile_image}`
      : null;

    // Step 4: Company details (if role is Company)
    let companyDetails = null;
    if (user.role === "Company") {
      companyDetails = {
        business_name: user.business_name,
        business_category: parseStringToArray(user.business_category),
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
        event_types: parseStringToArray(user.event_types),
        accessibility: parseStringToArray(user.accessibility),
      };
    }

    // Step 5: NDIS Information
    let ndisInfo = null;
    if (ndisResult.rows.length > 0) {
      const ndis = ndisResult.rows[0];
      ndisInfo = {
        ndis_number: ndis.ndis_number,
        preferred_event_types: parseStringToArray(ndis.preferred_event_types),
        primary_disability_type: parseStringToArray(ndis.primary_disability_type),
        support_requirements: parseStringToArray(ndis.support_requirements),
        created_at: ndis.created_at,
        updated_at: ndis.updated_at,
      };
    }

    // Step 6: Final response
    const response = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
      profile_image_url: user.profile_image_url,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      stripe_account_status: user.stripe_account_status === '3' ? "Active" : user.stripe_account_status === '2' ? "Under Review" : "Pending",
      is_verified: user.is_verified,
      created_at: user.created_at,
      updated_at: user.updated_at,
      business_details: companyDetails, // Only if company
      ndis_information: ndisInfo, // Null if no record found
      stripe_customer_id: user.stripe_customer_id,
    };

    res.json({ status: true, data: response });
  } catch (err) {
    console.error("Get Profile Error:", err.message);
    res.status(500).json({ status: false, error: "Failed to fetch profile." });
  }
};


exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  try {
    const verification_code = generateVerificationCode(); // Generate OTP

    // ✅ Update OTP for existing user
    const updateQuery = `
      UPDATE users
      SET verification_code = $1
      WHERE email = $2
      RETURNING id, email
    `;
    const values = [verification_code, email];
    const result = await pool.query(updateQuery, values);

    if (result.rowCount === 0) {
      // User not found
      return res.status(404).json({
        status: false,
        message: 'User not found. Please register first.',
      });
    }

    // Read email template
    let emailTemplate = fs.readFileSync(templatePath, 'utf-8');

    // Replace placeholders
    emailTemplate = emailTemplate
      .replace('{{full_name}}', email)
      .replace('{{otp}}', verification_code);

    // Send email
    const mailOptions = {
      from: `"Inclusable" <${EMAIL_FROM}>`,
      to: email,
      subject: 'Verify Your Email - OTP Code',
      html: emailTemplate,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: true,
      message: `OTP has been sent to ${email}.`,
    });

  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};


exports.createBankLink = async (req, res) => {
  try {
    const { stripe_customer_id } = req.body;

    if (!stripe_customer_id) {
      return res.status(400).json({ error: "stripe_customer_id is required" });
    }

    // Create Financial Connections Session
    const session = await stripe.financialConnections.sessions.create({
      account_holder: {
        type: "customer",
        customer: stripe_customer_id,
      },
      permissions: ["payment_method", "balances"],
      filters: { countries: ["US"] },
    });

    // Send session link to frontend
    res.json({
      success: true,
      message: "Bank link generated successfully.",
      data: {
        session_url: session.url, // Stripe-hosted link
        session_secret: session.client_secret,
        session_id: session.id
      }
    });
  } catch (error) {
    console.error("Create bank link error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id)
    return res.status(401).json({ status: false, message: 'Unauthorized' });

  const client = await pool.connect();

  try {
    // 1️⃣ Fetch user role
    const userRes = await client.query(
      `SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [user_id]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({
        status: false,
        message: 'User not found or already deleted.',
      });
    }

    const user = userRes.rows[0];

    // 2️⃣ Role-based restriction logic
    if (user.role === 'NDIS Member') {
      // Member cannot delete if they have booked future or ongoing events
      const bookingCheck = await client.query(
        `
        SELECT eb.id
        FROM event_bookings eb
        INNER JOIN company_events ce ON ce.id = eb.event_id
        WHERE eb.user_id = $1
          AND eb.status NOT IN ('cancelled')
          AND ce.end_date >= NOW()
        LIMIT 1
        `,
        [user_id]
      );

      if (bookingCheck.rows.length > 0) {
        return res.status(400).json({
          status: false,
          error:
            'You cannot delete your account because you have active or upcoming event bookings.',
        });
      }
    }

    if (user.role === 'Company') {
      // Company cannot delete if they have upcoming or ongoing events
      const eventCheck = await client.query(
        `
        SELECT id
        FROM company_events
        WHERE user_id = $1
          AND is_deleted IS false
          AND end_date >= NOW()
        LIMIT 1
        `,
        [user_id]
      );

      if (eventCheck.rows.length > 0) {
        // 3️⃣ Check if anyone has booked those upcoming events
        const bookedEventCheck = await client.query(
          `
          SELECT eb.id
          FROM event_bookings eb
          INNER JOIN company_events ce ON ce.id = eb.event_id
          WHERE ce.user_id = $1
            AND ce.end_date >= NOW()
            AND eb.status NOT IN ('cancelled')
          LIMIT 1
          `,
          [user_id]
        );

        if (bookedEventCheck.rows.length > 0) {
          return res.status(400).json({
            status: false,
            error:
              'You cannot delete your account because users have booked your upcoming or ongoing events.',
          });
        }

        return res.status(400).json({
          status: false,
          error:
            'You cannot delete your account because you have upcoming or ongoing events.',
        });
      }
    }

    // 4️⃣ Soft delete user
    const result = await client.query(
      `
      UPDATE users 
      SET deleted_at = NOW() 
      WHERE id = $1 AND deleted_at IS NULL 
      RETURNING *
      `,
      [user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: false,
        error: 'User not found or already deleted.',
      });
    }

    res.json({
      status: true,
      message: 'Your account has been deleted successfully.',
    });

  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({
      status: false,
      message: 'Server error',
      error: err.message,
    });
  } finally {
    client.release();
  }
};




exports.getNotifications = async (req, res) => {
  const { user_id, driver_id, target, is_read, page = 1, limit = 20 } = req.query;

  try {
    const safeLimit = Math.max(parseInt(limit) || 20, 1);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    let query = `
      SELECT 
        n.*,
        u.full_name AS user_name,

        -- Cab booking details
        cb.id AS cab_booking_id,
        cb.status AS cab_booking_status

      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      LEFT JOIN cab_bookings cb ON n.booking_id = cb.id
      LEFT JOIN company_events ce ON n.company_event_id = ce.id
      WHERE 1=1
    `;

    const values = [];

    if (user_id) {
      values.push(user_id);
      query += ` AND n.user_id = $${values.length}`;
    }

    if (driver_id) {
      values.push(driver_id);
      query += ` AND n.driver_id = $${values.length}`;
    }

    if (target) {
      values.push(target);
      query += ` AND n.target = $${values.length}`;
    }

    if (is_read !== undefined) {
      values.push(is_read === "true");
      query += ` AND n.is_read = $${values.length}`;
    }

    // Count query
    const countQuery = `SELECT COUNT(*) FROM (${query}) count_query`;
    const countResult = await pool.query(countQuery, values);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Pagination
    values.push(safeLimit, offset);
    query += `
      ORDER BY n.created_at DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `;

    const { rows } = await pool.query(query, values);

    res.status(200).json({
      status: true,
      message: "Notifications fetched successfully",
      page: safePage,
      limit: safeLimit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / safeLimit),
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res.status(500).json({
      status: false,
      message: "Error fetching notifications",
    });
  }
};

const generateOTP = () => Math.floor(1000 + Math.random() * 9000);

exports.registerCabOwner = async (req, res) => {
  try {
    const { full_name, email, password, phone_number, date_of_birth, address } = req.body;

    let profile_image = null;

    if (req.files) {
      if (req.files["profile_image"]?.[0]) {
        profile_image = req.files["profile_image"][0].filename;
      }
    }

    // 🧾 Validation
    if (!full_name || !email || !password || !phone_number || !date_of_birth || !address) {
      return res.status(400).json({
        status: false,
        message: 'All fields are required including date_of_birth and address.',
      });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ status: false, message: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();

    const insertQuery = `
      INSERT INTO users (
        full_name, email, password, phone_number, role,
        date_of_birth, address, profile_image, verification_code, is_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
    `;

    await pool.query(insertQuery, [
      full_name,
      email,
      hashedPassword,
      phone_number,
      'Cab Owner',
      date_of_birth,
      address,
      profile_image,
      otp,
    ]);

    // Load and replace placeholders in email template
    let emailTemplate = fs.readFileSync(templatePath, 'utf-8');
    emailTemplate = emailTemplate
      .replace('{{full_name}}', full_name)
      .replace('{{otp}}', otp);

    // ✅ Send Email
    const mailOptions = {
      from: `"Inclusable" <${EMAIL_FROM}>`,
      to: email,
      subject: 'Verify Your Email - OTP Code',
      html: emailTemplate,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: true,
      message: 'Cab Owner registered successfully. OTP has been sent to your email.',
      data: { email, otp }, // remove otp in production
    });
  } catch (error) {
    console.error('Cab Owner Register Error:', error);
    res.status(500).json({ status: false, message: 'Internal server error.' });
  }
};

exports.getStripeKeys = async (req, res) => {
  try {
    const { env } = req.params;

    if (!env || !["test", "production"].includes(env)) {
      return res.status(400).json({
        status: false,
        message: "Invalid environment. Use 'test' or 'production'."
      });
    }

    const query = `
      SELECT id, environment, publishable_key, secret_key, webhook_secret,
             created_at, updated_at
      FROM stripe_keys
      WHERE environment = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [env]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No Stripe keys found for environment: " + env
      });
    }

    return res.json({
      status: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("❌ Error fetching Stripe keys:", error.message);

    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
};

exports.privacyPolicy = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM privacy_policies ORDER BY created_at DESC');
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};

exports.termCondition = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM terms_conditions ORDER BY created_at DESC');
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
};


exports.sendChatNotification = async (req, res) => {
  const { title, message, user_id, id = null } = req.body;

  if (!title || !message || !user_id) {
    return res.status(400).json({
      status: false,
      message: "title, message and user_id are required",
    });
  }

  try {
    // ✅ CORRECT CALL
    await chatNotification({
      title,
      message,
      user_id,
      id,
    });

    res.status(200).json({
      status: true,
      message: "Notification sent successfully",
    });

  } catch (err) {
    console.error("❌ Send Notification Error:", err.message);
    res.status(500).json({
      status: false,
      message: "Failed to send notification",
    });
  }
};