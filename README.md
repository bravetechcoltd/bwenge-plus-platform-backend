ONGERA Platform - Complete Backend Implementation Guide
🎯 Project Overview Understanding
This platform connects Rwandan researchers, students, and diaspora through research sharing, communities, and events. The key is creating smart, reusable relationships where records created in one context serve multiple purposes across the platform.
________________________________________
📊 CORE DATABASE MODELS & RELATIONSHIPS
1. USER MANAGEMENT SYSTEM
Table: Users
Purpose: Central authentication and profile management
Fields:
•	id (Primary Key, UUID)
•	email (Unique, Required)
•	password_hash (Required)
•	username (Unique, Optional)
•	first_name, last_name
•	phone_number
•	profile_picture_url
•	bio (Text)
•	account_type (Enum: Student, Researcher, Diaspora, Institution)
•	is_verified (Boolean)
•	is_active (Boolean)
•	date_joined (Timestamp)
•	last_login (Timestamp)
•	country (For diaspora tracking)
•	city
•	social_auth_provider (Google/Facebook/None)
•	social_auth_id
Table: UserProfile (Extends User)
Purpose: Academic-specific information
Fields:
•	id (Primary Key)
•	user_id (Foreign Key → Users, One-to-One)
•	institution_name
•	department
•	academic_level (Enum: Undergraduate, Masters, PhD, Professional)
•	research_interests (Array/JSON or separate table)
•	orcid_id
•	google_scholar_url
•	linkedin_url
•	website_url
•	cv_file_url
•	total_projects_count (Cached)
•	total_followers_count (Cached)
•	total_following_count (Cached)
Smart Relationship: User + UserProfile = Complete Identity used everywhere
________________________________________
2. RESEARCH PROJECT SYSTEM
Table: ResearchProjects
Purpose: Core content - research uploads
Fields:
•	id (Primary Key, UUID)
•	author_id (Foreign Key → Users)
•	title (Required)
•	abstract (Text, Required)
•	full_description (Rich Text)
•	status (Enum: Draft, Published, Under Review, Archived)
•	research_type (Enum: Thesis, Paper, Project, Dataset, Case Study)
•	project_file_url (Main document)
•	cover_image_url
•	publication_date (If published elsewhere)
•	created_at, updated_at
•	is_featured (Boolean)
•	visibility (Enum: Public, Community-Only, Private)
•	view_count (Integer)
•	download_count (Integer)
•	collaboration_status (Enum: Solo, Seeking Collaborators, Collaborative)
Smart Implementation: This is created ONCE and reused across communities, events, and user profiles.
Table: ProjectFiles
Purpose: Multiple file attachments per project
Fields:
•	id (Primary Key)
•	project_id (Foreign Key → ResearchProjects)
•	file_url (Required)
•	file_name
•	file_type (PDF, DOCX, CSV, etc.)
•	file_size (Bytes)
•	uploaded_at
•	description
Relationship: One Project → Many Files
Table: ProjectTags
Purpose: Categorization and searchability
Fields:
•	id (Primary Key)
•	name (Unique)
•	slug (Unique)
•	description
•	usage_count (How many projects use it)
•	category (Enum: Field, Method, Topic, Region)
Table: ProjectTagAssociation (Junction Table)
Fields:
•	project_id (Foreign Key → ResearchProjects)
•	tag_id (Foreign Key → ProjectTags)
•	created_at
Relationship: Many Projects ↔ Many Tags
________________________________________
3. COMMUNITY SYSTEM
Table: Communities
Purpose: Interest-based groups
Fields:
•	id (Primary Key, UUID)
•	name (Required)
•	slug (Unique)
•	description (Text)
•	cover_image_url
•	creator_id (Foreign Key → Users)
•	community_type (Enum: Public, Private, Institution-Specific)
•	category (Health, Tech, Environment, Agriculture, etc.)
•	member_count (Cached)
•	post_count (Cached)
•	created_at
•	is_active (Boolean)
•	join_approval_required (Boolean)
Table: CommunityMembers (Junction Table)
Purpose: Track membership with roles
Fields:
•	id (Primary Key)
•	community_id (Foreign Key → Communities)
•	user_id (Foreign Key → Users)
•	role (Enum: Admin, Moderator, Member)
•	joined_at
•	is_active (Boolean)
•	notifications_enabled (Boolean)
Relationship: Many Users ↔ Many Communities (with role metadata)
Smart Reuse: When user joins community, their projects can be auto-shared there.
Table: CommunityPosts
Purpose: Discussion content within communities
Fields:
•	id (Primary Key, UUID)
•	community_id (Foreign Key → Communities)
•	author_id (Foreign Key → Users)
•	post_type (Enum: Discussion, Question, Resource, Announcement, LinkedProject)
•	title (Optional for some types)
•	content (Rich Text)
•	linked_project_id (Foreign Key → ResearchProjects, Nullable) ← SMART REUSE
•	linked_event_id (Foreign Key → Events, Nullable) ← SMART REUSE
•	media_urls (Array/JSON)
•	is_pinned (Boolean)
•	is_locked (Boolean)
•	view_count
•	created_at, updated_at
Smart Implementation: Posts can LINK to existing projects/events instead of recreating content.
________________________________________
4. EVENT SYSTEM
Table: Events
Purpose: Webinars, conferences, workshops
Fields:
•	id (Primary Key, UUID)
•	organizer_id (Foreign Key → Users)
•	community_id (Foreign Key → Communities, Nullable) ← Can be community-specific or standalone
•	title (Required)
•	description (Rich Text)
•	event_type (Enum: Webinar, Conference, Workshop, Seminar, Meetup)
•	event_mode (Enum: Online, Physical, Hybrid)
•	start_datetime (Required)
•	end_datetime (Required)
•	timezone
•	location_address (For physical/hybrid)
•	online_meeting_url (Zoom/Google Meet)
•	meeting_id, meeting_password (For video platforms)
•	cover_image_url
•	max_attendees (Nullable = unlimited)
•	registration_deadline
•	is_free (Boolean)
•	price_amount (If paid)
•	status (Enum: Upcoming, Ongoing, Completed, Cancelled)
•	requires_approval (Boolean)
•	created_at, updated_at
Smart Reuse: Events can be linked to communities AND have related projects showcased.
Table: EventAttendees (Junction Table with extra data)
Fields:
•	id (Primary Key)
•	event_id (Foreign Key → Events)
•	user_id (Foreign Key → Users)
•	registration_status (Enum: Registered, Approved, Rejected, Waitlisted, Attended, NoShow)
•	registered_at
•	approval_note (If requires approval)
•	check_in_time (Attendance tracking)
•	certificate_issued (Boolean)
Table: EventAgenda
Purpose: Schedule within an event
Fields:
•	id (Primary Key)
•	event_id (Foreign Key → Events)
•	session_title
•	description
•	speaker_name
•	speaker_id (Foreign Key → Users, Nullable)
•	start_time
•	end_time
•	session_type (Presentation, Panel, Q&A, Break)
•	linked_project_id (Foreign Key → ResearchProjects, Nullable) ← SMART: Present research
•	display_order
Smart Implementation: Agenda items can link to projects being presented.
Table: EventProjects (Junction Table)
Purpose: Showcase projects at events
Fields:
•	event_id (Foreign Key → Events)
•	project_id (Foreign Key → ResearchProjects)
•	showcase_type (Enum: Poster, Presentation, Demo)
•	added_at
Relationship: Many Events ↔ Many Projects
________________________________________
5. ENGAGEMENT SYSTEM (Universal Interactions)
These tables serve ALL content types (projects, posts, events) - MAXIMUM REUSABILITY
Table: Likes
Purpose: Universal like system
Fields:
•	id (Primary Key)
•	user_id (Foreign Key → Users)
•	content_type (Enum: Project, Post, Comment, Event)
•	content_id (UUID of the liked item)
•	created_at
Composite Unique: (user_id, content_type, content_id)
Smart Design: ONE table handles all likes across platform
Table: Comments
Purpose: Universal commenting
Fields:
•	id (Primary Key, UUID)
•	author_id (Foreign Key → Users)
•	content_type (Enum: Project, Post, Event)
•	content_id (UUID)
•	parent_comment_id (Foreign Key → Comments, for nested replies)
•	comment_text (Text, Required)
•	media_url (Optional image/file)
•	is_edited (Boolean)
•	created_at, updated_at
Smart Design: ONE table for all comments everywhere + supports threading
Table: Follows
Purpose: User-to-user following
Fields:
•	id (Primary Key)
•	follower_id (Foreign Key → Users)
•	following_id (Foreign Key → Users)
•	created_at
Composite Unique: (follower_id, following_id)
Table: Bookmarks
Purpose: Save items for later
Fields:
•	id (Primary Key)
•	user_id (Foreign Key → Users)
•	content_type (Enum: Project, Post, Event, Community)
•	content_id (UUID)
•	created_at
________________________________________
6. KNOWLEDGE SHARING SYSTEM
Table: BlogPosts
Purpose: Articles and research notes
Fields:
•	id (Primary Key, UUID)
•	author_id (Foreign Key → Users)
•	title (Required)
•	slug (Unique)
•	content (Rich Text)
•	excerpt (Short summary)
•	cover_image_url
•	status (Draft, Published, Archived)
•	published_at
•	view_count
•	reading_time_minutes (Auto-calculated)
•	category (Same as community categories)
•	linked_project_id (Foreign Key → ResearchProjects, Nullable) ← SMART REUSE
•	created_at, updated_at
Smart Implementation: Blog posts can reference existing projects.
Table: QAThreads
Purpose: Question & Answer format
Fields:
•	id (Primary Key, UUID)
•	asker_id (Foreign Key → Users)
•	community_id (Foreign Key → Communities, Nullable)
•	question_title (Required)
•	question_content (Text)
•	tags (Array/JSON or junction table)
•	status (Open, Answered, Closed)
•	accepted_answer_id (Foreign Key → QAAnswers, Nullable)
•	view_count
•	created_at, updated_at
Table: QAAnswers
Fields:
•	id (Primary Key, UUID)
•	thread_id (Foreign Key → QAThreads)
•	answerer_id (Foreign Key → Users)
•	answer_content (Text)
•	upvote_count (Cached)
•	is_accepted (Boolean)
•	created_at, updated_at
Relationship: One Question → Many Answers
________________________________________
7. NOTIFICATION SYSTEM
Table: Notifications
Purpose: Real-time updates for all activities
Fields:
•	id (Primary Key, UUID)
•	recipient_id (Foreign Key → Users)
•	actor_id (Foreign Key → Users, who triggered it)
•	notification_type (Enum: Like, Comment, Follow, EventReminder, NewPost, ProjectFeatured, CommunityInvite, etc.)
•	content_type (Enum: Project, Post, Event, Comment, Community)
•	content_id (UUID)
•	message (Text)
•	is_read (Boolean)
•	read_at (Timestamp)
•	created_at
Smart Design: ONE table tracks all notification types
Table: NotificationPreferences
Fields:
•	user_id (Foreign Key → Users, One-to-One)
•	email_notifications_enabled (Boolean)
•	push_notifications_enabled (Boolean)
•	new_follower_notify (Boolean)
•	project_comment_notify (Boolean)
•	event_reminder_notify (Boolean)
•	community_post_notify (Boolean)
•	weekly_digest (Boolean)
________________________________________
8. ANALYTICS & TRACKING
Table: ActivityLogs
Purpose: Track user actions for analytics
Fields:
•	id (Primary Key)
•	user_id (Foreign Key → Users, Nullable for anonymous)
•	action_type (Enum: View, Download, Search, Share, Register)
•	content_type (Project, Event, Community, etc.)
•	content_id (UUID)
•	ip_address
•	user_agent
•	created_at
Smart Use: Generate trending content, recommendations
Table: SearchQueries
Fields:
•	id (Primary Key)
•	user_id (Foreign Key → Users, Nullable)
•	query_text
•	results_count
•	created_at
Purpose: Improve search, understand user needs
________________________________________
🔗 SMART RELATIONSHIP PATTERNS
Pattern 1: Content Reusability
ResearchProject (created once)
    ↓ Referenced by:
    ├── CommunityPosts (linked_project_id)
    ├── EventProjects (showcase)
    ├── EventAgenda (presentation topic)
    ├── BlogPosts (reference in article)
    └── User Profile (portfolio)
Pattern 2: Universal Engagement
Likes, Comments, Bookmarks tables
    ↓ Serve all content types using:
    - content_type (enum)
    - content_id (UUID)
    
Single endpoint: POST /api/likes/
Body: {content_type: "project", content_id: "123"}
Pattern 3: Event-Community-Project Triangle
Event
    ├── belongs_to → Community (optional)
    ├── showcases → Projects (many-to-many)
    └── has → Attendees (users)

One endpoint: POST /api/events/
Creates event + links community + attaches projects
Pattern 4: Hierarchical Content
Community
    ├── has → Members
    ├── has → Posts
    │       └── can link → Projects (existing)
    │       └── can link → Events (existing)
    └── can host → Events
________________________________________
👤 COMPLETE USER JOURNEY
Journey 1: New User Registration → Active Researcher
Step 1: Registration
•	User fills: email, password, name, account_type
•	Creates: Users record
•	Triggers: Verification email
Step 2: Profile Completion
•	User adds: institution, research interests, bio
•	Creates: UserProfile record (linked to User)
•	System: Suggests communities based on interests
Step 3: First Project Upload
•	User creates project with title, abstract, files
•	Creates: ResearchProjects record (author_id = user)
•	Creates: Multiple ProjectFiles records
•	Creates: ProjectTagAssociation records (linking to ProjectTags)
•	System: Suggests relevant communities to share in
Step 4: Community Engagement
•	User joins 2 communities
•	Creates: CommunityMembers records (role = Member)
•	User shares project in community
•	Creates: CommunityPosts record (linked_project_id = project, post_type = LinkedProject)
•	REUSE: No duplication - post references existing project
Step 5: Event Discovery & Registration
•	User browses events, finds conference
•	User registers
•	Creates: EventAttendees record (status = Registered)
•	Creates: Notifications record (event reminder)
Step 6: Active Participation
•	User comments on another project
•	Creates: Comments record (content_type = Project, content_id = project_id)
•	User likes a community post
•	Creates: Likes record (content_type = Post)
•	User follows another researcher
•	Creates: Follows record (follower_id = user, following_id = other_user)
•	REUSE: All using universal engagement tables
Step 7: Event Attendance & Networking
•	User attends event
•	Updates: EventAttendees record (check_in_time, status = Attended)
•	User presents project at event
•	Creates: EventProjects record (linking event + project)
•	REUSE: Same project used in multiple contexts
________________________________________
Journey 2: Event Organizer Flow
Step 1: Event Creation
•	Organizer creates event details
•	Creates: Events record (organizer_id = user)
•	Optionally links to community
•	Sets: community_id (if community event)
Step 2: Add Event Schedule
•	Organizer creates agenda with sessions
•	Creates: Multiple EventAgenda records
•	Links sessions to projects being presented
•	Sets: linked_project_id (REUSE existing projects)
Step 3: Manage Registrations
•	Users register (creates EventAttendees)
•	If requires_approval = True, organizer reviews
•	Updates: EventAttendees.registration_status
•	Creates: Notifications for approved/rejected users
Step 4: Event Execution
•	Attendees check-in
•	Updates: EventAttendees.check_in_time
•	System tracks: ActivityLogs (action_type = Register)
Step 5: Post-Event
•	System generates certificates
•	Updates: EventAttendees.certificate_issued
•	Organizer creates post-event blog
•	Creates: BlogPosts (linked to event via content)
________________________________________
Journey 3: Community Manager Flow
Step 1: Community Creation
•	User creates community with name, description, category
•	Creates: Communities record (creator_id = user)
•	Creates: CommunityMembers record (role = Admin)
Step 2: Member Invitation
•	Admin invites users
•	Creates: Notifications (type = CommunityInvite)
•	Users accept
•	Creates: CommunityMembers records
Step 3: Content Curation
•	Admin creates welcome post
•	Creates: CommunityPosts (post_type = Announcement)
•	Members share projects
•	Creates: CommunityPosts (linked_project_id, REUSE)
•	Community hosts event
•	Creates: Events (community_id set, LINKED)
Step 4: Moderation
•	Admin pins important posts
•	Updates: CommunityPosts.is_pinned
•	Admin removes spam comment
•	Deletes: Comments record
________________________________________
🚀 ENDPOINT EFFICIENCY EXAMPLES
Smart Endpoint 1: Universal Like
POST /api/engagement/like/
Body: {
  content_type: "project" | "post" | "comment" | "event",
  content_id: "uuid"
}
One endpoint serves 4 content types!
Smart Endpoint 2: Create Event with Everything
POST /api/events/
Body: {
  event_details: {...},
  community_id: "uuid",  // Link to community
  linked_projects: ["project-id-1", "project-id-2"],  // Showcase existing
  agenda_items: [
    {title: "...", linked_project_id: "..."}  // REUSE
  ]
}
One endpoint creates event + links community + attaches projects + builds agenda
Smart Endpoint 3: Share Project in Community
POST /api/communities/{id}/posts/
Body: {
  post_type: "linked_project",
  linked_project_id: "existing-project-uuid",
  message: "Check out my research!"
}
No duplication - references existing project
Smart Endpoint 4: Batch Fetch User Activity
GET /api/users/{id}/activity/
Returns: {
  projects: [...],
  posts: [...],
  events_attended: [...],
  comments: [...],
  communities: [...]
}
One endpoint queries multiple tables efficiently
________________________________________
🎯 KEY IMPLEMENTATION PRINCIPLES
1. Create Once, Reference Many
•	Projects created once → shared in communities, events, blogs
•	Users created once → participate everywhere
•	Tags created once → used across projects
2. Universal Tables for Universal Actions
•	Likes table serves all content
•	Comments table serves all content
•	Notifications table tracks all activities
3. Junction Tables with Metadata
•	CommunityMembers stores role, join date
•	EventAttendees stores registration status, check-in
•	ProjectTagAssociation can track creation date
4. Polymorphic Relationships
•	content_type + content_id pattern
•	Allows single table to reference multiple entities
•	Reduces table count dramatically
5. Caching Computed Values
•	Store counts (followers, projects, members)
•	Update via signals/triggers
•	Faster reads, occasional writes
6. Status & State Management
•	Use enums for all statuses
•	Draft → Published workflows
•	Registration → Approved flows
7. Soft Deletes
•	Add is_active or deleted_at fields
•	Never hard delete user content
•	Maintain data integrity
________________________________________
📈 EXPECTED TABLE COUNT
Core Tables: 25-28 tables
•	Users & Auth: 2 tables
•	Research: 4 tables
•	Communities: 3 tables
•	Events: 4 tables
•	Engagement: 4 tables (universal)
•	Knowledge: 3 tables
•	Notifications: 2 tables
•	Analytics: 2 tables
•	Junction Tables: 5-6 tables
Smart Design Result: Could have been 40+ tables, reduced to ~28 through reusability!
________________________________________
✅ IMPLEMENTATION CHECKLIST
1.	Start with Core Identity: Users → UserProfile
2.	Build Content: ResearchProjects → ProjectFiles → ProjectTags
3.	Add Social Layer: Communities → CommunityMembers → CommunityPosts
4.	Enable Events: Events → EventAttendees → EventAgenda → EventProjects
5.	Universal Engagement: Likes → Comments → Follows → Bookmarks
6.	Knowledge Layer: BlogPosts → QAThreads → QAAnswers
7.	Communication: Notifications → NotificationPreferences
8.	Analytics: ActivityLogs → SearchQueries
Each layer builds on previous, creating a cohesive, interconnected system!

