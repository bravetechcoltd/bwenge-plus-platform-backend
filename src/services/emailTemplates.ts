// ============================================================
// BwengePlus Email Templates
// Replace the email template functions in emailTemplates.ts
// Primary color: #5b4e96 (blue-600) — matches BwengePlus brand
// ============================================================

import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const generateOTP = (length: number = 6): string => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
};

// ─── Shared layout wrapper ────────────────────────────────────────────────────
const emailBase = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BwengePlus</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(91,78,150,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4a3f80 0%,#5b4e96 60%,#7c6fc4 100%);padding:28px 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="display:inline-flex;align-items:center;gap:10px;">
                    <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                      <span style="color:#ffffff;font-size:18px;font-weight:800;line-height:1;">B+</span>
                    </div>
                    <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">BwengePlus</span>
                  </div>
                  <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:12px;letter-spacing:0.5px;">Never Stop Learning</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f7ff;border-top:1px solid #e8e3f7;padding:20px 32px;text-align:center;">
            <p style="margin:0 0 4px;color:#64748b;font-size:12px;">BwengePlus — Rwanda's Premier Learning Platform</p>
            <p style="margin:0;color:#94a3b8;font-size:11px;">
              Questions? <a href="mailto:support@bwengeplus.rw" style="color:#5b4e96;text-decoration:none;font-weight:600;">support@bwengeplus.rw</a>
            </p>
            <p style="margin:8px 0 0;color:#cbd5e1;font-size:11px;">© ${new Date().getFullYear()} BwengePlus. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
`;

// ─── OTP Code Block ───────────────────────────────────────────────────────────
const otpBlock = (otp: string, label = "Your Verification Code", expiry = "10 minutes") => `
  <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:12px;padding:24px;text-align:center;margin:20px 0;">
    <p style="margin:0 0 10px;color:#5b4e96;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${label}</p>
    <div style="font-family:'Courier New',monospace;font-size:40px;font-weight:800;color:#4a3f80;letter-spacing:14px;margin:8px 0 12px;">${otp}</div>
    <p style="margin:0;color:#7c6fc4;font-size:12px;">⏱ Expires in ${expiry}</p>
  </div>
`;

// ─── Section header ───────────────────────────────────────────────────────────
const sectionHeading = (icon: string, text: string) => `
  <p style="margin:0 0 10px;color:#4a3f80;font-size:13px;font-weight:700;">${icon} ${text}</p>
`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. WELCOME + VERIFICATION OTP  (new learner registration)
// ─────────────────────────────────────────────────────────────────────────────
export const sendBwengeWelcomeOTP = async (
  email: string,
  firstName: string,
  lastName: string,
  otp: string
): Promise<boolean> => {
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Welcome, ${firstName}! 🎉</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Your BwengePlus account has been created. Verify your email to unlock full access to thousands of courses.
    </p>

    <div style="display:inline-block;background:#ede9ff;color:#5b4e96;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px;">🎓 LEARNER ACCOUNT</div>

    ${otpBlock(otp, "Email Verification Code", "10 minutes")}

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-top:4px;">
      ${sectionHeading("📋", "How to verify:")}
      <ol style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:2;">
        <li>Enter the 6-digit code on the verification page</li>
        <li>Your email will be verified instantly</li>
        <li>Start exploring courses right away</li>
      </ol>
    </div>

    <div style="background:#FEF9EC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 16px;margin-top:16px;">
      <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
        <strong>🔒 Security tip:</strong> If you didn't create a BwengePlus account, please ignore this email.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🎓 Verify your BwengePlus account",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. EMAIL VERIFICATION OTP  (resend / general verify)
// ─────────────────────────────────────────────────────────────────────────────
export const sendVerificationOTP = async (
  email: string,
  firstName: string,
  lastName: string,
  otp: string
): Promise<boolean> => {
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Hello, ${firstName}!</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Please use the verification code below to confirm your BwengePlus email address.
    </p>

    <div style="display:inline-block;background:#ede9ff;color:#5b4e96;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px;">🔐 VERIFICATION REQUIRED</div>

    ${otpBlock(otp, "Email Verification Code", "10 minutes")}

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-top:4px;">
      ${sectionHeading("📋", "Steps:")}
      <ol style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:2;">
        <li>Enter the 6-digit code on the verification page</li>
        <li>Your email will be verified automatically</li>
        <li>Full platform access is unlocked</li>
      </ol>
    </div>

    <div style="background:#FEF9EC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 16px;margin-top:16px;">
      <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
        <strong>🔒 Security:</strong> If you didn't request this, please ignore this email and contact support.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🔐 Verify your BwengePlus email",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. PASSWORD RESET OTP
// ─────────────────────────────────────────────────────────────────────────────
export const sendPasswordChangeOTP = async (
  email: string,
  firstName: string,
  lastName: string,
  otp: string
): Promise<boolean> => {
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Reset your password</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Hi <strong>${firstName}</strong>, use the code below to reset your BwengePlus password.
    </p>

    <div style="display:inline-block;background:#ede9ff;color:#5b4e96;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px;">🔑 PASSWORD RESET</div>

    ${otpBlock(otp, "Password Reset Code", "10 minutes")}

    <div style="background:#F0FDF4;border-left:3px solid #22c55e;border-radius:6px;padding:14px 16px;margin-top:4px;">
      ${sectionHeading("🛡️", "Password Tips:")}
      <ul style="margin:6px 0 0;padding-left:18px;color:#166534;font-size:12px;line-height:1.9;">
        <li>Use at least 8 characters</li>
        <li>Mix uppercase, lowercase, numbers &amp; symbols</li>
        <li>Avoid personal information</li>
      </ul>
    </div>

    <div style="background:#FFF1F2;border-left:3px solid #f43f5e;border-radius:6px;padding:12px 16px;margin-top:12px;">
      <p style="margin:0;color:#9f1239;font-size:12px;line-height:1.6;">
        <strong>⚠️ Important:</strong> If you didn't request a password reset, secure your account immediately by contacting support.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🔑 BwengePlus — Password Reset Code",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. EMAIL VERIFIED SUCCESS
// ─────────────────────────────────────────────────────────────────────────────
export const sendEmailVerifiedNotification = async (
  email: string,
  firstName: string,
  lastName: string
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">You're verified, ${firstName}! ✅</h2>
    <p style="margin:0 0 4px;color:#22c55e;font-size:15px;font-weight:700;">Your email has been confirmed successfully.</p>

    <div style="display:inline-block;background:#DCFCE7;color:#15803d;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin:12px 0 4px;">✅ ACCOUNT ACTIVATED</div>

    <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:12px;padding:20px;text-align:center;margin:16px 0 8px;">
      <div style="font-size:42px;margin-bottom:8px;">🎓</div>
      <p style="margin:0;color:#4a3f80;font-size:16px;font-weight:800;">Welcome to BwengePlus!</p>
      <p style="margin:6px 0 0;color:#7c6fc4;font-size:13px;">Your learning journey starts now.</p>
    </div>

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-top:12px;">
      ${sectionHeading("🚀", "Get started:")}
      <div style="margin-top:8px;">
        <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
          <span style="display:inline-block;background:#5b4e96;color:#fff;width:20px;height:20px;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;margin-right:10px;flex-shrink:0;">1</span>
          <span style="color:#475569;font-size:13px;line-height:1.5;"><strong style="color:#0f172a;">Browse courses</strong> — explore thousands of free &amp; premium courses</span>
        </div>
        <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
          <span style="display:inline-block;background:#5b4e96;color:#fff;width:20px;height:20px;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;margin-right:10px;flex-shrink:0;">2</span>
          <span style="color:#475569;font-size:13px;line-height:1.5;"><strong style="color:#0f172a;">Complete your profile</strong> — personalize your learning experience</span>
        </div>
        <div style="display:flex;align-items:flex-start;">
          <span style="display:inline-block;background:#5b4e96;color:#fff;width:20px;height:20px;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;margin-right:10px;flex-shrink:0;">3</span>
          <span style="color:#475569;font-size:13px;line-height:1.5;"><strong style="color:#0f172a;">Earn certificates</strong> — showcase your skills to the world</span>
        </div>
      </div>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="${frontendUrl}/dashboard/learner/learning/courses"
         style="display:inline-block;background:#5b4e96;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.2px;">
        🏠 Go to Dashboard →
      </a>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🎉 BwengePlus — You're all set!",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. INSTRUCTOR CREDENTIALS
// ─────────────────────────────────────────────────────────────────────────────
export const sendInstructorCredentials = async (
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  institutionName: string
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Welcome, ${firstName}! 👨‍🏫</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Your instructor account on BwengePlus has been created by <strong>${institutionName}</strong>.
    </p>

    <div style="display:inline-block;background:#ede9ff;color:#5b4e96;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">👨‍🏫 INSTRUCTOR ACCOUNT</div>

    <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:12px;padding:20px;margin-bottom:16px;">
      <p style="margin:0 0 12px;color:#5b4e96;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Your Login Credentials</p>
      <div style="background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;">Email:</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#4a3f80;">${email}</p>
      </div>
      <div style="background:#fff;border-radius:8px;padding:12px;">
        <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;">Temporary Password:</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#4a3f80;">${password}</p>
      </div>
      <p style="margin:10px 0 0;color:#7c6fc4;font-size:12px;">⚠️ Change your password after first login</p>
    </div>

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-bottom:16px;">
      ${sectionHeading("📋", "Your Responsibilities:")}
      <ol style="margin:6px 0 0;padding-left:18px;color:#475569;font-size:13px;line-height:1.9;">
        <li>Review student research projects assigned to you</li>
        <li>Approve, return for revision, or reject projects</li>
        <li>Provide constructive feedback to learners</li>
      </ol>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="${frontendUrl}/login"
         style="display:inline-block;background:#5b4e96;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">
        🚀 Login to Dashboard →
      </a>
    </div>

    <div style="background:#FEF9EC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 16px;margin-top:16px;">
      <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
        <strong>🔒 Security:</strong> This is a temporary password. Change it immediately after logging in. Never share your credentials.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "👨‍🏫 BwengePlus — Your Instructor Credentials",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. STUDENT CREDENTIALS
// ─────────────────────────────────────────────────────────────────────────────
export const sendStudentCredentials = async (
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  instructorName: string,
  institutionName: string
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Welcome, ${firstName}! 🎓</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Your student account on BwengePlus has been created by <strong>${institutionName}</strong>.
    </p>

    <div style="display:inline-block;background:#DCFCE7;color:#15803d;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">🎓 STUDENT ACCOUNT</div>

    <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:12px;padding:20px;margin-bottom:16px;">
      <p style="margin:0 0 12px;color:#5b4e96;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Your Login Credentials</p>
      <div style="background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;">
        <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;">Email:</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#4a3f80;">${email}</p>
      </div>
      <div style="background:#fff;border-radius:8px;padding:12px;">
        <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;">Temporary Password:</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#4a3f80;">${password}</p>
      </div>
      <p style="margin:10px 0 0;color:#7c6fc4;font-size:12px;">⚠️ Change your password after first login</p>
    </div>

    <div style="background:#F0FDF4;border-left:3px solid #22c55e;border-radius:6px;padding:14px 16px;margin-bottom:12px;">
      <p style="margin:0 0 4px;color:#15803d;font-size:12px;font-weight:700;">👨‍🏫 Your Assigned Instructor</p>
      <p style="margin:0;color:#166534;font-size:13px;">${instructorName}</p>
      <p style="margin:4px 0 0;color:#16a34a;font-size:11px;">Your projects will be reviewed by this instructor.</p>
    </div>

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-bottom:16px;">
      ${sectionHeading("📚", "How It Works:")}
      <ol style="margin:6px 0 0;padding-left:18px;color:#475569;font-size:13px;line-height:1.9;">
        <li>Upload your research project</li>
        <li>Your instructor reviews and provides feedback</li>
        <li>Approved projects become publicly visible</li>
      </ol>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="${frontendUrl}/login"
         style="display:inline-block;background:#5b4e96;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">
        🚀 Login to Dashboard →
      </a>
    </div>

    <div style="background:#FEF9EC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 16px;margin-top:16px;">
      <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
        <strong>🔒 Security:</strong> Change your temporary password immediately after logging in.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🎓 BwengePlus — Your Student Credentials",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. APPLICATION RECEIVED  (sent to applicant on registration)
// ─────────────────────────────────────────────────────────────────────────────
export const sendApplicationReceivedEmail = async (
  email: string,
  firstName: string,
  lastName: string
): Promise<boolean> => {
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Application Received, ${firstName}! 📋</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      Thank you for applying to join <strong>BwengePlus</strong>. Your application has been submitted successfully and is now under review.
    </p>

    <div style="display:inline-block;background:#FEF9C3;color:#92400e;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">⏳ PENDING REVIEW</div>

    <div style="background:#f8f7ff;border-radius:12px;padding:20px;margin-bottom:16px;">
      <p style="margin:0 0 10px;color:#4a3f80;font-size:13px;font-weight:700;">📋 What happens next:</p>
      <ol style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:2;">
        <li>Our system admin will review your application</li>
        <li>You will receive an email once a decision is made</li>
        <li>If approved, you can log in and start learning immediately</li>
      </ol>
    </div>

    <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center;">
      <p style="margin:0 0 6px;color:#5b4e96;font-size:13px;font-weight:700;">⏱ Expected Review Time</p>
      <p style="margin:0;color:#7c6fc4;font-size:14px;font-weight:600;">24–48 hours</p>
      <p style="margin:4px 0 0;color:#64748b;font-size:12px;">We'll notify you by email</p>
    </div>

    <div style="background:#FEF9EC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 16px;">
      <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
        <strong>📌 Note:</strong> Please do not try to log in before you receive your approval email. Your account is not active yet.
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "📋 BwengePlus — Application Received",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. NEW APPLICATION NOTIFICATION  (sent to system admin)
// ─────────────────────────────────────────────────────────────────────────────
export const sendAdminNewApplicationEmail = async (
  adminEmail: string,
  applicant: {
    first_name: string;
    last_name: string;
    email: string;
    phone_number?: string;
    country?: string;
    date_of_birth?: string;
    gender?: string;
    education_level?: string;
    motivation?: string;
    linkedin_url?: string;
    applied_at: string;
    applicationId: string;
  }
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">New Application Received 🔔</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      A new user has applied to join BwengePlus and is awaiting your approval.
    </p>

    <div style="display:inline-block;background:#ede9ff;color:#5b4e96;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">👤 NEW APPLICANT</div>

    <div style="background:#f8f7ff;border-radius:12px;padding:20px;margin-bottom:16px;">
      <p style="margin:0 0 12px;color:#4a3f80;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Applicant Details</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Full Name</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;font-weight:600;">${applicant.first_name} ${applicant.last_name}</span></td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Email</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#5b4e96;font-size:13px;font-weight:600;">${applicant.email}</span></td></tr>
        ${applicant.phone_number ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Phone</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.phone_number}</span></td></tr>` : ''}
        ${applicant.country ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Country</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.country}</span></td></tr>` : ''}
        ${applicant.date_of_birth ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Date of Birth</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.date_of_birth}</span></td></tr>` : ''}
        ${applicant.gender ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Gender</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.gender}</span></td></tr>` : ''}
        ${applicant.education_level ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">Education Level</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.education_level}</span></td></tr>` : ''}
        ${applicant.linkedin_url ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;font-size:12px;">LinkedIn</span></td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><a href="${applicant.linkedin_url}" style="color:#5b4e96;font-size:12px;">View Profile</a></td></tr>` : ''}
        <tr><td style="padding:6px 0;"><span style="color:#64748b;font-size:12px;">Applied At</span></td><td style="padding:6px 0;text-align:right;"><span style="color:#0f172a;font-size:13px;">${applicant.applied_at}</span></td></tr>
      </table>
    </div>

    ${applicant.motivation ? `
    <div style="background:#F0FDF4;border-left:3px solid #22c55e;border-radius:6px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;color:#15803d;font-size:12px;font-weight:700;">💬 Motivation / Why they want to join:</p>
      <p style="margin:0;color:#166534;font-size:13px;line-height:1.7;font-style:italic;">"${applicant.motivation}"</p>
    </div>
    ` : ''}

    <div style="text-align:center;margin-top:20px;">
      <a href="${frontendUrl}/dashboard/system-admin/applications"
         style="display:inline-block;background:#5b4e96;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;margin-right:10px;">
        ✅ Review Application →
      </a>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `🔔 New Application: ${applicant.first_name} ${applicant.last_name}`,
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. ACCOUNT ACTIVATED  (sent to user when admin approves)
// ─────────────────────────────────────────────────────────────────────────────
export const sendAccountActivatedEmail = async (
  email: string,
  firstName: string,
  lastName: string
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Great news, ${firstName}! 🎉</h2>
    <p style="margin:0 0 4px;color:#22c55e;font-size:15px;font-weight:700;">Your BwengePlus account has been approved!</p>

    <div style="display:inline-block;background:#DCFCE7;color:#15803d;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin:12px 0 16px;">✅ ACCOUNT ACTIVATED</div>

    <div style="background:#f0eeff;border:1px solid #c5bcee;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;">
      <div style="font-size:42px;margin-bottom:8px;">🎓</div>
      <p style="margin:0;color:#4a3f80;font-size:16px;font-weight:800;">Welcome to BwengePlus!</p>
      <p style="margin:6px 0 0;color:#7c6fc4;font-size:13px;">You can now log in and start your learning journey.</p>
    </div>

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 10px;color:#4a3f80;font-size:13px;font-weight:700;">🚀 Get started:</p>
      <ol style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:2;">
        <li>Click the button below to go to the login page</li>
        <li>Use your registered email and password to sign in</li>
        <li>Complete your profile and start exploring courses</li>
      </ol>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="${frontendUrl}/login"
         style="display:inline-block;background:#5b4e96;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">
        🔐 Login to BwengePlus →
      </a>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🎉 BwengePlus — Your account has been activated!",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. ACCOUNT REJECTED  (sent to user when admin rejects)
// ─────────────────────────────────────────────────────────────────────────────
export const sendAccountRejectedEmail = async (
  email: string,
  firstName: string,
  lastName: string,
  reason?: string
): Promise<boolean> => {
  const body = `
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:800;">Application Update, ${firstName}</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7;">
      We have reviewed your application to join BwengePlus and unfortunately we are unable to approve it at this time.
    </p>

    <div style="display:inline-block;background:#FEE2E2;color:#991b1b;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">❌ APPLICATION NOT APPROVED</div>

    ${reason ? `
    <div style="background:#FFF1F2;border-left:3px solid #f43f5e;border-radius:6px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;color:#9f1239;font-size:12px;font-weight:700;">📋 Reason:</p>
      <p style="margin:0;color:#be123c;font-size:13px;line-height:1.7;">${reason}</p>
    </div>
    ` : ''}

    <div style="background:#f8f7ff;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 8px;color:#475569;font-size:13px;line-height:1.7;">
        If you believe this decision was made in error or would like to provide additional information, please contact our support team.
      </p>
      <p style="margin:0;color:#475569;font-size:13px;">
        Email: <a href="mailto:support@bwengeplus.rw" style="color:#5b4e96;text-decoration:none;font-weight:600;">support@bwengeplus.rw</a>
      </p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: `"BwengePlus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "📋 BwengePlus — Application Status Update",
      html: emailBase(body),
    });
    return true;
  } catch (err) {
    return false;
  }
};