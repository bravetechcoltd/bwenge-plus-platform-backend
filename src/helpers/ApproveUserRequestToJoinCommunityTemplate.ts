
interface JoinRequestData {
  community_name: string;
  community_description: string;
  community_id: string;
  cover_image_url?: string;
  requester: {
    first_name: string;
    last_name: string;
    email: string;
    profile_picture_url?: string;
    account_type: string;
    profile?: {
      institution_name?: string;
      field_of_study?: string;
    };
  };
  request_id: string;
  requested_at: Date;
}

interface CreatorData {
  first_name: string;
  email: string;
}

interface ApprovedMemberData {
  first_name: string;
  email: string;
}

export class ApproveUserRequestToJoinCommunityTemplate {
  // Email to creator when user requests to join
  static getJoinRequestNotification(
    requestData: JoinRequestData,
    creatorData: CreatorData
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Member Request</title>
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
        Hello ${creatorData.first_name},
      </div>
      
      <div style="color: #4a4a4a; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
        A new member has requested to join your community. Please review their profile and decide whether to approve their request.
      </div>
      
      <!-- Status Badge -->
      <span style="display: inline-block; background: #ffc107; color: #000; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 10px 0;">
        👋 NEW REQUEST
      </span>
      
      <!-- Community Highlight -->
      <div style="background: #E3F2FD; padding: 18px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">COMMUNITY</div>
        <div style="color: #1a1a1a; font-size: 16px; font-weight: 600;">${requestData.community_name}</div>
      </div>
      
      <!-- Member Information -->
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e9ecef;">
        <div style="color: #495057; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 15px;">
          REQUESTER INFORMATION
        </div>
        
        <!-- Profile Header -->
        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
          ${requestData.requester.profile_picture_url ? `
            <img src="${requestData.requester.profile_picture_url}" alt="${requestData.requester.first_name}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 3px solid #0158B7;">
          ` : `
            <div style="width: 60px; height: 60px; border-radius: 50%; background: #0158B7; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: 700; border: 3px solid #E3F2FD;">
              ${requestData.requester.first_name[0]}${requestData.requester.last_name[0]}
            </div>
          `}
          <div>
            <div style="color: #1a1a1a; font-size: 18px; font-weight: 700;">
              ${requestData.requester.first_name} ${requestData.requester.last_name}
            </div>
            <div style="color: #6c757d; font-size: 14px;">${requestData.requester.account_type}</div>
          </div>
        </div>
        
        <!-- Member Details -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #dee2e6;">
            <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              📧 Email
            </div>
            <div style="color: #1a1a1a; font-size: 13px; font-weight: 600;">${requestData.requester.email}</div>
          </div>
          
          ${requestData.requester.profile?.institution_name ? `
          <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #dee2e6;">
            <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              🏛️ Institution
            </div>
            <div style="color: #1a1a1a; font-size: 13px; font-weight: 600;">${requestData.requester.profile.institution_name}</div>
          </div>
          ` : ''}
          
          ${requestData.requester.profile?.field_of_study ? `
          <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #dee2e6;">
            <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              📚 Field of Study
            </div>
            <div style="color: #1a1a1a; font-size: 13px; font-weight: 600;">${requestData.requester.profile.field_of_study}</div>
          </div>
          ` : ''}
          
          <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #dee2e6;">
            <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              ⏰ Requested
            </div>
            <div style="color: #1a1a1a; font-size: 13px; font-weight: 600;">
              ${new Date(requestData.requested_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
        </div>
      </div>
      
      <!-- Action Required -->
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">⏰ Action Required</div>
        <div style="color: #856404; font-size: 14px; line-height: 1.5;">
          The user is waiting for your approval. Please review and respond as soon as possible.
        </div>
      </div>
      
      <!-- Action Buttons -->
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/user/communities/join-requests/${requestData.community_id}" 
           style="display: inline-block; background: #28a745; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 8px 8px 8px 0;">
          ✅ Approve Request
        </a>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/user/communities/join-requests/${requestData.community_id}" 
           style="display: inline-block; background: #dc3545; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 8px;">
          ❌ Reject Request
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Rwanda Research Hub</strong><br>
        Building Rwanda's Academic Community Together
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        © ${new Date().getFullYear()} Rwanda Research Hub. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }

  // Email to user when approved
  static getMembershipApprovedTemplate(
    communityData: { name: string; description: string; community_id: string; cover_image_url?: string },
    memberData: ApprovedMemberData
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${communityData.name}</title>
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
        Hello ${memberData.first_name},
      </div>
      
      <div style="color: #28a745; font-size: 17px; font-weight: 600; margin-bottom: 15px;">
        🎊 Congratulations! Your request has been approved!
      </div>
      
      <!-- Status Badge -->
      <span style="display: inline-block; background: #28a745; color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 10px 0;">
        ✅ APPROVED
      </span>
      
      <!-- Community Highlight -->
      <div style="background: #E3F2FD; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">YOU ARE NOW A MEMBER OF</div>
        <div style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin-bottom: 12px;">${communityData.name}</div>
        <div style="color: #4a4a4a; font-size: 14px; line-height: 1.5;">${communityData.description}</div>
      </div>
      
      <!-- Access Information -->
      <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #155724; font-weight: 600; font-size: 15px; margin-bottom: 12px;">🚀 What's Next?</div>
        <div style="color: #155724; font-size: 14px; line-height: 1.6;">
          You now have full access to share research, ideas, projects, blogs, and connect with fellow researchers in this community!
        </div>
      </div>
      
      <!-- Action Button -->
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/user/communities/dashboard/${communityData.community_id}" 
           style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 8px 0;">
          🏠 Visit Community Now
        </a>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 25px 0;"></div>
      
      <!-- Getting Started Tips -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 12px;">💡 Getting Started Tips</div>
        <ul style="color: #6c757d; font-size: 14px; line-height: 1.6; margin: 0; padding-left: 20px;">
          <li>Introduce yourself to the community</li>
          <li>Explore existing discussions and research</li>
          <li>Share your expertise and insights</li>
          <li>Connect with members in your field</li>
        </ul>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Rwanda Research Hub</strong><br>
        Building Rwanda's Academic Community Together
      </div>
      <div style="color: #6c757d; font-size: 13px;">
        © ${new Date().getFullYear()} Rwanda Research Hub. All rights reserved.
      </div>
    </div>
    
  </div>
</body>
</html>
    `;
  }
}