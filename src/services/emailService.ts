import nodemailer from 'nodemailer';
export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ==================== GENERIC EMAIL SENDER ====================
export const sendEmail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> => {
  try {
    await transporter.sendMail({
      from: options.from || process.env.EMAIL_USER,
      to: options.to,
      subject: options.subject,
      html: options.html
    });
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

// ==================== INSTITUTION INVITATION EMAIL ====================
export const sendInstitutionInvitation = async (
  email: string,
  firstName: string,
  lastName: string,
  institutionName: string,
  role: string,
  invitationLink: string
): Promise<boolean> => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Institution Invitation - BwengePlus</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <div style="color: white; font-size: 28px; font-weight: bold; letter-spacing: 1px;">BWENGEPLUS</div>
      <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 8px;">Learning Without Limits</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 40px 30px; background: white;">
      <div style="font-size: 20px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${firstName} ${lastName},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
        You have been invited to join <strong style="color: #667eea;">${institutionName}</strong> on BwengePlus as a <strong>${role}</strong>.
      </div>
      
      <!-- Invitation Box -->
      <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #667eea;">
        <div style="color: #667eea; font-weight: 600; font-size: 16px; margin-bottom: 15px;">
          🎓 Your Role: ${role}
        </div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.6;">
          As a ${role}, you will have access to create and manage courses, collaborate with other instructors, and help build an amazing learning experience.
        </div>
      </div>
      
      <!-- CTA Button -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="${invitationLink}" 
           style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
          ✨ Accept Invitation
        </a>
      </div>
      
      <div style="color: #6c757d; font-size: 13px; text-align: center; margin-top: 20px;">
        This invitation link will expire in 7 days
      </div>
      
      <!-- What's Next -->
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
        <div style="color: #667eea; font-weight: 600; font-size: 15px; margin-bottom: 15px;">
          📋 What happens next?
        </div>
        <ol style="color: #4a4a4a; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>Click the "Accept Invitation" button above</li>
          <li>Complete your account setup (if you're new)</li>
          <li>Access your institution dashboard</li>
          <li>Start creating amazing courses!</li>
        </ol>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>BwengePlus Learning Platform</strong><br>
        Empowering Education Through Technology
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        Need help? <a href="mailto:support@bwengeplus.rw" style="color: #667eea; text-decoration: none; font-weight: 600;">support@bwengeplus.rw</a>
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">
        © ${new Date().getFullYear()} BwengePlus. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `🎓 You're Invited to ${institutionName} on BwengePlus`,
    html
  });
};

// ==================== ENROLLMENT NOTIFICATION EMAIL ====================
export const sendEnrollmentNotification = async (
  email: string,
  studentName: string,
  courses: Array<{ title: string; instructorName: string; startUrl: string }>
): Promise<boolean> => {
  const coursesList = courses.map((course, index) => `
    <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #667eea;">
      <div style="font-size: 16px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px;">
        ${index + 1}. ${course.title}
      </div>
      <div style="color: #6c757d; font-size: 14px; margin-bottom: 12px;">
        👨‍🏫 Instructor: ${course.instructorName}
      </div>
      <a href="${course.startUrl}" 
         style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">
        Start Learning →
      </a>
    </div>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Course Enrollment - BwengePlus</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <div style="color: white; font-size: 28px; font-weight: bold;">BWENGEPLUS</div>
      <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 8px;">🎉 Enrollment Confirmed!</div>
    </div>
    
    <div style="padding: 40px 30px; background: white;">
      <div style="font-size: 20px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${studentName},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
        Great news! You've been successfully enrolled in ${courses.length} course${courses.length > 1 ? 's' : ''} on BwengePlus.
      </div>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        ${coursesList}
      </div>
      
      <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 20px; border-radius: 8px; margin: 25px 0;">
        <div style="color: #667eea; font-weight: 600; font-size: 15px; margin-bottom: 12px;">
          💡 Quick Tips to Get Started:
        </div>
        <ul style="color: #4a4a4a; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>Complete your profile to track your progress</li>
          <li>Set up learning goals and schedules</li>
          <li>Engage with course materials and assessments</li>
          <li>Connect with instructors and fellow students</li>
        </ul>
      </div>
    </div>
    
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px;">
        Happy Learning! 🚀<br>
        <a href="mailto:support@bwengeplus.rw" style="color: #667eea; text-decoration: none;">support@bwengeplus.rw</a>
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">
        © ${new Date().getFullYear()} BwengePlus. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `🎓 You're Enrolled! Start Learning on BwengePlus`,
    html
  });
};

// ==================== ENROLLMENT APPROVAL REQUEST EMAIL ====================
export const sendEnrollmentApprovalRequest = async (
  instructorEmail: string,
  instructorName: string,
  studentName: string,
  studentEmail: string,
  courseName: string,
  message: string,
  approveUrl: string,
  rejectUrl: string
): Promise<boolean> => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enrollment Approval Request - BwengePlus</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <div style="color: white; font-size: 28px; font-weight: bold;">BWENGEPLUS</div>
      <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 8px;">📝 Enrollment Request</div>
    </div>
    
    <div style="padding: 40px 30px; background: white;">
      <div style="font-size: 20px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${instructorName},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
        A student has requested to enroll in your course and needs your approval.
      </div>
      
      <!-- Student Info -->
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <div style="color: #667eea; font-weight: 600; font-size: 15px; margin-bottom: 15px;">
          👤 Student Information
        </div>
        <div style="color: #1a1a1a; font-size: 14px; margin-bottom: 8px;">
          <strong>Name:</strong> ${studentName}
        </div>
        <div style="color: #1a1a1a; font-size: 14px; margin-bottom: 8px;">
          <strong>Email:</strong> ${studentEmail}
        </div>
        <div style="color: #1a1a1a; font-size: 14px;">
          <strong>Course:</strong> ${courseName}
        </div>
      </div>
      
      ${message ? `
      <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
        <div style="color: #667eea; font-weight: 600; font-size: 14px; margin-bottom: 10px;">
          💬 Message from Student:
        </div>
        <div style="color: #4a4a4a; font-size: 14px; line-height: 1.6; font-style: italic;">
          "${message}"
        </div>
      </div>
      ` : ''}
      
      <!-- Action Buttons -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="${approveUrl}" 
           style="display: inline-block; background: #10b981; color: white; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 0 10px;">
          ✓ Approve
        </a>
        <a href="${rejectUrl}" 
           style="display: inline-block; background: #ef4444; color: white; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 0 10px;">
          ✗ Reject
        </a>
      </div>
    </div>
    
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px;">
        <a href="mailto:support@bwengeplus.rw" style="color: #667eea; text-decoration: none;">support@bwengeplus.rw</a>
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">
        © ${new Date().getFullYear()} BwengePlus. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: instructorEmail,
    subject: `📝 Enrollment Approval Needed: ${courseName}`,
    html
  });
};

// ==================== COURSE INSTRUCTOR ASSIGNMENT EMAIL ====================
export const sendInstructorAssignment = async (
  email: string,
  instructorName: string,
  courseTitle: string,
  assignedBy: string,
  courseUrl: string,
  permissions: {
    can_grade: boolean;
    can_manage_enrollments: boolean;
    can_edit_content: boolean;
  }
): Promise<boolean> => {
  const permissionsList = [
    permissions.can_grade && '✓ Grade assignments and assessments',
    permissions.can_manage_enrollments && '✓ Manage student enrollments',
    permissions.can_edit_content && '✓ Edit course content'
  ].filter(Boolean).join('<br>');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Course Assignment - BwengePlus</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <div style="color: white; font-size: 28px; font-weight: bold;">BWENGEPLUS</div>
      <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 8px;">👨‍🏫 Course Assignment</div>
    </div>
    
    <div style="padding: 40px 30px; background: white;">
      <div style="font-size: 20px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${instructorName},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
        You have been assigned as an instructor for <strong style="color: #667eea;">${courseTitle}</strong> by ${assignedBy}.
      </div>
      
      <!-- Permissions Box -->
      <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #667eea;">
        <div style="color: #667eea; font-weight: 600; font-size: 16px; margin-bottom: 15px;">
          🔑 Your Permissions:
        </div>
        <div style="color: #4a4a4a; font-size: 14px; line-height: 1.8;">
          ${permissionsList}
        </div>
      </div>
      
      <!-- CTA Button -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="${courseUrl}" 
           style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          📚 Manage Course
        </a>
      </div>
    </div>
    
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px;">
        <a href="mailto:support@bwengeplus.rw" style="color: #667eea; text-decoration: none;">support@bwengeplus.rw</a>
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">
        © ${new Date().getFullYear()} BwengePlus. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `👨‍🏫 You've Been Assigned to ${courseTitle}`,
    html
  });
};

// ==================== ACCESS CODE EMAIL ====================
export const sendAccessCodes = async (
  email: string,
  recipientName: string,
  courseName: string,
  codes: string[],
  expiryDate?: Date
): Promise<boolean> => {
  const codesList = codes.map((code, index) => `
    <div style="background: white; padding: 15px; border-radius: 6px; margin: 8px 0; font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; color: #667eea; text-align: center; border: 2px dashed #667eea;">
      ${code}
    </div>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0;">
  <title>Access Codes - BwengePlus</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <div style="color: white; font-size: 28px; font-weight: bold;">BWENGEPLUS</div>
      <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 8px;">🔑 Course Access Codes</div>
    </div>
    
    <div style="padding: 40px 30px; background: white;">
      <div style="font-size: 20px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${recipientName},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
        Here are your access codes for <strong style="color: #667eea;">${courseName}</strong>. Share these codes with students to grant them access to the course.
      </div>
      
      <!-- Codes Box -->
      <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 25px; border-radius: 12px; margin: 25px 0;">
        <div style="color: #667eea; font-weight: 600; font-size: 16px; margin-bottom: 15px; text-align: center;">
          📋 Access Codes (${codes.length} total)
        </div>
        ${codesList}
        ${expiryDate ? `
        <div style="color: #ef4444; font-size: 13px; margin-top: 15px; text-align: center;">
          ⏰ Expires: ${expiryDate.toLocaleDateString()}
        </div>
        ` : ''}
      </div>
      
      <!-- Instructions -->
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <div style="color: #667eea; font-weight: 600; font-size: 15px; margin-bottom: 12px;">
          📌 How to Use:
        </div>
        <ol style="color: #4a4a4a; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>Share codes with your students via email or learning management system</li>
          <li>Students enter the code when enrolling in the course</li>
          <li>Each code can be used according to your settings (one-time or unlimited)</li>
          <li>Track code usage in your instructor dashboard</li>
        </ol>
      </div>
    </div>
    
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px;">
        <a href="mailto:support@bwengeplus.rw" style="color: #667eea; text-decoration: none;">support@bwengeplus.rw</a>
      </div>
      <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">
        © ${new Date().getFullYear()} BwengePlus. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `🔑 Access Codes for ${courseName}`,
    html
  });
};

// Export all functions
export default {
  sendEmail,
  sendInstitutionInvitation,
  sendEnrollmentNotification,
  sendEnrollmentApprovalRequest,
  sendInstructorAssignment,
  sendAccessCodes
};