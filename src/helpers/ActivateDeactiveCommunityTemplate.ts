interface CommunityData {
  name: string;
  description: string;
  category: string;
  member_count: number;
  cover_image_url?: string;
  creator: {
    first_name: string;
    last_name: string;
    profile?: {
      institution_name?: string;
    };
  };
  community_id: string;
  is_active: boolean;
  reason?: string;
}

interface UserData {
  first_name: string;
  email: string;
}

export class ActivateDeactiveCommunityTemplate {
  static getStatusChangeTemplate(
    communityData: CommunityData,
    userData: UserData,
    isActivation: boolean
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
  <title>Community ${statusText}</title>
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
          ? `Great news! The community "${communityData.name}" has been activated and is now live!` 
          : `We are writing to inform you that the community "${communityData.name}" has been deactivated.`
        }
      </div>
      
      <span style="display: inline-block; background: ${statusColor}; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        ${statusBadge}
      </span>
      
      <!-- Highlight Box -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">COMMUNITY NAME</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600;">${communityData.name}</div>
        ${communityData.description ? `
        <div style="color: #6c757d; font-size: 13px; margin-top: 8px;">${communityData.description}</div>
        ` : ''}
      </div>
      
      <!-- Community Details -->
      <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          COMMUNITY INFORMATION
        </div>
        <div style="color: #212529; font-size: 15px;">
          <strong>Category:</strong> ${communityData.category}<br>
          <strong>Members:</strong> ${communityData.member_count}<br>
          <strong>Created by:</strong> ${communityData.creator.first_name} ${communityData.creator.last_name}<br>
          ${communityData.creator.profile?.institution_name ? `<strong>Institution:</strong> ${communityData.creator.profile.institution_name}` : ''}
        </div>
      </div>
      
      ${!isActivation && communityData.reason ? `
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">REASON FOR DEACTIVATION</div>
        <div style="color: #856404; font-size: 15px;">${communityData.reason}</div>
      </div>
      ` : ''}
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${isActivation 
          ? 'You can now access all community features, create posts, participate in discussions, and connect with fellow members!' 
          : 'This community is currently unavailable. All posts, discussions, and member activities have been suspended.'
        }
      </div>
      
      ${isActivation ? `
      <!-- Action Button -->
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/${communityData.community_id}" 
         style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0;">
        Visit Community Now
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
        Start engaging with the community today!
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
}