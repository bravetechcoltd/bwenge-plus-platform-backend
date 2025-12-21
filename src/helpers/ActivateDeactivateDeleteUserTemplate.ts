interface UserData {
  first_name: string;
  last_name: string;
  email: string;
  account_type: string;
  profile?: {
    institution_name?: string;
    academic_level?: string;
  };
}

export class ActivateDeactivateDeleteUserTemplate {
  static getStatusChangeTemplate(
    userData: UserData,
    isActivation: boolean,
    reason?: string
  ): string {
    const statusText = isActivation ? 'Activated' : 'Deactivated';
    const statusBadge = isActivation ? 'ACTIVATED' : 'DEACTIVATED';
    const statusColor = isActivation ? '#28a745' : '#dc3545';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account ${statusText}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <!-- Header -->
    <div style="background: #0158B7; padding: 25px 30px; text-align: center;">
      <div style="color: white; font-size: 26px; font-weight: bold; letter-spacing: 1px;">ONGERA</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 30px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${userData.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${isActivation 
          ? 'Great news! Your account has been activated and is now fully operational.' 
          : 'We are writing to inform you that your account has been deactivated.'
        }
      </div>
      
      <span style="display: inline-block; background: ${statusColor}; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        ${statusBadge}
      </span>
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">ACCOUNT STATUS UPDATE</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600;">
          ${userData.first_name} ${userData.last_name}
        </div>
      </div>
      
      <!-- Account Details -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          ACCOUNT INFORMATION
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Full Name:</strong> ${userData.first_name} ${userData.last_name}<br>
          <strong>Email:</strong> ${userData.email}<br>
          <strong>Account Type:</strong> ${userData.account_type}<br>
          ${userData.profile?.institution_name ? `<strong>Institution:</strong> ${userData.profile.institution_name}<br>` : ''}
          ${userData.profile?.academic_level ? `<strong>Academic Level:</strong> ${userData.profile.academic_level}` : ''}
        </div>
      </div>
      
      ${!isActivation && reason ? `
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">REASON FOR DEACTIVATION</div>
        <div style="color: #856404; font-size: 15px;">${reason}</div>
      </div>
      ` : ''}
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${isActivation 
          ? 'You now have full access to all platform features including research projects, communities, events, and collaboration tools.' 
          : 'Your account access has been temporarily suspended. You will not be able to log in or access platform features.'
        }
      </div>
      
      ${isActivation ? `
      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" 
         style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0;">
        Login to Your Account
      </a>
      ` : ''}
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      ${!isActivation ? `
      <!-- Support Box -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">📧 Need Assistance?</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          If you have questions about this deactivation or need to appeal this decision, please contact our admin team at support@ongera.com
        </div>
      </div>
      ` : `
      <div style="color: #6c757d; font-size: 13px;">
        Complete your profile and start exploring the platform!
      </div>
      `}
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Ongera Platform</strong><br>
        Connecting Researchers & Academics Worldwide
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }

  static getDeletionTemplate(userData: UserData): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Deleted</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    
    <!-- Header -->
    <div style="background: #0158B7; padding: 25px 30px; text-align: center;">
      <div style="color: white; font-size: 26px; font-weight: bold; letter-spacing: 1px;">ONGERA</div>
    </div>
    
    <!-- Body -->
    <div style="padding: 30px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${userData.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        We are writing to inform you that your account with Ongera Platform has been permanently deleted.
      </div>
      
      <span style="display: inline-block; background: #dc3545; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        DELETED
      </span>
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">DELETED ACCOUNT</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600;">
          ${userData.first_name} ${userData.last_name}
        </div>
      </div>
      
      <!-- Account Details -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          DELETED ACCOUNT INFORMATION
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Full Name:</strong> ${userData.first_name} ${userData.last_name}<br>
          <strong>Email:</strong> ${userData.email}<br>
          <strong>Account Type:</strong> ${userData.account_type}<br>
          <strong>Deletion Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
      </div>
      
      <!-- Info Box -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">ℹ️ What This Means</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          • All your research projects, posts, and contributions have been removed<br>
          • Your community memberships and event registrations have been cancelled<br>
          • You will not be able to log in with this email address<br>
          • This action is permanent and cannot be undone
        </div>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <!-- Support Box -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">📧 Questions or Concerns?</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          If you believe this was done in error or have questions, please contact our support team immediately at support@ongera.com
        </div>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Ongera Platform</strong><br>
        Connecting Researchers & Academics Worldwide
      </div>
      <div style="color: #6c757d; font-size: 13px; margin-bottom: 8px;">
        Thank you for being part of Ongera Platform.
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }
}