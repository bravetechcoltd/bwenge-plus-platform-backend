interface CommunityData {
  name: string;
  description: string;
  category: string;
  community_type: string;
  cover_image_url?: string;
  creator: {
    first_name: string;
    last_name: string;
    email: string;
    profile?: {
      institution_name?: string;
    };
  };
  community_id: string;
  created_at: Date;
}

interface AdminData {
  first_name: string;
  email: string;
}

export class SendEmailToAdminTemplate {
  static getNewCommunityNotification(
    communityData: CommunityData,
    adminData: AdminData
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Community Awaiting Approval</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
  <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(91,78,150,0.10);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg,#4a3f80 0%,#5b4e96 60%,#7c6fc4 100%); padding: 24px 32px;">
      <div style="color: white; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">Ongera</div>
      <div style="color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 4px; letter-spacing: 0.5px;">Admin Notifications</div>
    </div>

    <!-- Body -->
    <div style="padding: 28px 32px 24px; background: white;">
      <div style="font-size: 18px; color: #1a1a1a; margin-bottom: 20px; font-weight: 600;">
        Hello ${adminData.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        A new community has been created and is awaiting your review and approval.
      </div>
      
      <span style="display: inline-block; background: #ffc107; color: #000; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 5px 0;">
        PENDING APPROVAL
      </span>
      
      ${communityData.cover_image_url ? `
      <!-- Cover Image -->
      <div style="margin: 20px 0;">
        <img src="${communityData.cover_image_url}" alt="${communityData.name}" style="width: 100%; height: auto; border-radius: 8px; display: block;">
      </div>
      ` : ''}
      
      <!-- Highlight Box -->
      <div style="background: #f0eeff; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #5b4e96;">
        <div style="color: #5b4e96; font-weight: 600; font-size: 14px; margin-bottom: 8px;">COMMUNITY NAME</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600; line-height: 1.4;">${communityData.name}</div>
      </div>
      
      <!-- Description -->
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        ${communityData.description}
      </div>
      
      <!-- Community Details -->
      <div style="background: #f8f7ff; padding: 15px; border-radius: 10px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          COMMUNITY DETAILS
        </div>
        <div style="color: #212529; font-size: 15px; line-height: 1.8;">
          <div style="margin: 8px 0;">
            <strong>Category:</strong> ${communityData.category}
          </div>
          <div style="margin: 8px 0;">
            <strong>Type:</strong> ${communityData.community_type}
          </div>
          <div style="margin: 8px 0;">
            <strong>Created:</strong> ${new Date(communityData.created_at).toLocaleString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>

      <!-- Creator Info -->
      <div style="background: #f8f7ff; padding: 15px; border-radius: 10px; margin: 15px 0;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
          CREATED BY
        </div>
        <div style="color: #212529; font-size: 15px; line-height: 1.8;">
          <div style="margin: 8px 0;">
            <strong>Name:</strong> ${communityData.creator.first_name} ${communityData.creator.last_name}
          </div>
          <div style="margin: 8px 0;">
            <strong>Email:</strong> ${communityData.creator.email}
          </div>
          ${communityData.creator.profile?.institution_name ? `
          <div style="margin: 8px 0;">
            <strong>Institution:</strong> ${communityData.creator.profile.institution_name}
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Action Required Box -->
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">⚠️ ACTION REQUIRED</div>
        <div style="color: #856404; font-size: 15px;">
          Please review the community details above and decide whether to approve or reject this community. The creator will be notified of your decision.
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="margin: 20px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/communities/pending"
           style="display: inline-block; background: #5b4e96; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 10px 10px 10px 0;">
          Open Admin Panel
        </a>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 20px 0;"></div>
      
      <!-- Review Guidelines -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #5b4e96; font-weight: 600; font-size: 15px; margin-bottom: 8px;">📋 Review Guidelines</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5;">
          • Verify the community name and description are appropriate<br>
          • Check if the category matches the community purpose<br>
          • Ensure content aligns with platform guidelines<br>
          • Verify creator credentials if necessary
        </div>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f7ff; padding: 20px 32px; text-align: center; border-top: 1px solid #e8e3f7;">
      <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 4px;">
        <strong>Ongera Platform</strong> — Admin Notifications
      </div>
      <div style="color: #94a3b8; font-size: 11px;">
        © ${new Date().getFullYear()} Ongera. All rights reserved.
      </div>
    </div>

  </div>
  </div>
</body>
</html>
    `;
  }
}