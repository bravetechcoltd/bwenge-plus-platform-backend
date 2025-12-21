interface CommunityData {
  name: string;
  description: string;
  category: string;
  community_type: string;
  cover_image_url?: string;
  community_id: string;
}

interface CreatorData {
  first_name: string;
  email: string;
}

export class ApproveRejectCommunityToCreatorTemplate {
  
  /**
   * Generate email template for community approval notification
   */
  static getApprovalTemplate(
    communityData: CommunityData,
    creatorData: CreatorData
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Community Approved!</title>
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
        Great news! Your community application has been reviewed and approved by our admin team.
      </div>
      
      <!-- Status Badge -->
      <span style="display: inline-block; background: #28a745; color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 10px 0;">
        ✅ APPROVED
      </span>
      
      <!-- Community Highlight -->
      <div style="background: #E3F2FD; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">COMMUNITY NAME</div>
        <div style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin-bottom: 12px;">${communityData.name}</div>
        <div style="color: #4a4a4a; font-size: 14px; line-height: 1.5;">${communityData.description}</div>
      </div>
      
      <!-- Community Details -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0;">
        <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid #e9ecef;">
          <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
            📊 Category
          </div>
          <div style="color: #1a1a1a; font-size: 14px; font-weight: 600;">${communityData.category}</div>
        </div>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid #e9ecef;">
          <div style="color: #495057; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
            🔧 Type
          </div>
          <div style="color: #1a1a1a; font-size: 14px; font-weight: 600;">${communityData.community_type}</div>
        </div>
      </div>
      
      <!-- Success Message -->
      <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #155724; font-weight: 600; font-size: 15px; margin-bottom: 8px;">🎉 Congratulations!</div>
        <div style="color: #155724; font-size: 14px; line-height: 1.5;">
          Your community is now officially part of the Rwanda Research Hub platform. Start engaging with members and building your academic community!
        </div>
      </div>
      
      <!-- Action Buttons -->
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/${communityData.community_id}" 
           style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 8px 8px 8px 0;">
          🚀 View Community
        </a>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/${communityData.community_id}/manage" 
           style="display: inline-block; background: white; color: #0158B7; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 2px solid #0158B7; margin: 8px;">
          ⚙️ Manage Settings
        </a>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/${communityData.community_id}/invite" 
           style="display: inline-block; background: white; color: #0158B7; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 2px solid #0158B7; margin: 8px;">
          👥 Invite Members
        </a>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 25px 0;"></div>
      
      <!-- Support Section -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 8px;">📞 Need Help Managing Your Community?</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5; margin-bottom: 15px;">
          Our support team is here to help you succeed in building and managing your community.
        </div>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/support" 
           style="display: inline-block; background: #f8f9fa; color: #0158B7; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 1px solid #dee2e6;">
          Contact Support Team
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Rwanda Research Hub</strong><br>
        Building Rwanda's Academic Community Together
      </div>
      <div style="color: #6c757d; font-size: 13px; margin-bottom: 8px;">
        📧 support@researchhub.rw • 📞 +250 XXX XXX XXX
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

  static getRejectionTemplate(
    communityData: CommunityData,
    creatorData: CreatorData,
    reason?: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Community Application Update</title>
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
        Thank you for your interest in creating a community on Rwanda Research Hub. After careful review by our admin team, we regret to inform you that your community application was not approved at this time.
      </div>
      
      <!-- Status Badge -->
      <span style="display: inline-block; background: #dc3545; color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 10px 0;">
        ❌ NOT APPROVED
      </span>
      
      <!-- Community Highlight -->
      <div style="background: #E3F2FD; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0158B7;">
        <div style="color: #0158B7; font-weight: 600; font-size: 14px; margin-bottom: 8px;">COMMUNITY NAME</div>
        <div style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin-bottom: 12px;">${communityData.name}</div>
        <div style="color: #4a4a4a; font-size: 14px; line-height: 1.5;">${communityData.description}</div>
      </div>

      ${reason ? `
      <!-- Reason Box -->
      <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #721c24; font-weight: 600; font-size: 14px; margin-bottom: 8px;">📋 REASON FOR REJECTION</div>
        <div style="color: #721c24; font-size: 14px; line-height: 1.5;">${reason}</div>
      </div>
      ` : `
      <!-- No Reason Provided -->
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #856404; font-weight: 600; font-size: 14px; margin-bottom: 8px;">ℹ️ ADDITIONAL INFORMATION</div>
        <div style="color: #856404; font-size: 14px; line-height: 1.5;">
          For specific details about why your application was not approved, please contact our support team.
        </div>
      </div>
      `}
      
      <!-- Next Steps -->
      <div style="background: #d1ecf1; border-left: 4px solid #0c5460; padding: 18px; border-radius: 6px; margin: 20px 0;">
        <div style="color: #0c5460; font-weight: 600; font-size: 15px; margin-bottom: 12px;">💡 What You Can Do Next</div>
        <ul style="color: #0c5460; font-size: 14px; line-height: 1.6; margin: 0; padding-left: 20px;">
          <li>Review our community guidelines and platform requirements</li>
          <li>Revise your community description to make it clear and compelling</li>
          <li>Ensure content aligns with academic standards</li>
          <li>Submit a new application with improvements</li>
        </ul>
      </div>
      
      <!-- Action Buttons -->
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities/create" 
           style="display: inline-block; background: #0158B7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 8px 8px 8px 0;">
          🔄 Create New Community
        </a>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/support" 
           style="display: inline-block; background: white; color: #0158B7; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 2px solid #0158B7; margin: 8px;">
          💬 Contact Support
        </a>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/communities" 
           style="display: inline-block; background: white; color: #0158B7; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 2px solid #0158B7; margin: 8px;">
          🔍 Explore Communities
        </a>
      </div>
      
      <div style="height: 1px; background: #e9ecef; margin: 25px 0;"></div>
      
      <!-- Guidelines Section -->
      <div style="background: white; padding: 18px; border-radius: 8px; margin-top: 20px; border: 2px solid #e9ecef;">
        <div style="color: #0158B7; font-weight: 600; font-size: 15px; margin-bottom: 12px;">📚 Community Guidelines</div>
        <div style="color: #6c757d; font-size: 14px; line-height: 1.5; margin-bottom: 15px;">
          Before creating a new community, please review our comprehensive guidelines to ensure your application meets all requirements.
        </div>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/guidelines" 
           style="display: inline-block; background: #f8f9fa; color: #0158B7; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px; border: 1px solid #dee2e6;">
          Read Community Guidelines
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 2px solid #e9ecef;">
      <div style="color: #6c757d; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
        <strong>Rwanda Research Hub</strong><br>
        Building Rwanda's Academic Community Together
      </div>
      <div style="color: #6c757d; font-size: 13px; margin-bottom: 8px;">
        📧 support@researchhub.rw • 📞 +250 XXX XXX XXX
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
